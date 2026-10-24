import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { DataSource, EntityManager } from 'typeorm';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

/** Access tokens (JWT) are short-lived; the refresh token is what keeps a session. */
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
/**
 * Sliding: every refresh issues a new token valid this long, so a user who
 * opens the app at least once a month stays signed in (product decision, B4).
 */
export const REFRESH_TOKEN_TTL_DAYS = 30;
/** Expired rows are kept one extra day before the cleanup deletes them. */
const CLEANUP_GRACE_DAYS = 1;

const DAY_MS = 24 * 60 * 60 * 1000;

export type RevokeReason = 'logout' | 'reuse' | 'account';

export interface IssuedRefreshToken {
  /** The opaque token for the client. Never stored: only its hash is. */
  refreshToken: string;
  /** The session id (`sid` in the access token). */
  familyId: string;
  expiresAt: Date;
}

/** Every refresh failure answers the same, whatever the reason. */
export const INVALID_REFRESH_TOKEN = 'Invalid refresh token';

/** 256 random bits; the SHA-256 of that is enough to store (not a password). */
export const hashRefreshToken = (token: string) =>
  createHash('sha256').update(token, 'utf8').digest('hex');

interface FamilyRow {
  id: string;
  user_id: string;
  revoked_at: Date | null;
  is_active: boolean;
  deleted_at: Date | null;
}

interface TokenRow {
  id: string;
  expires_at: Date;
  replaced_by: string | null;
}

type RotateOutcome =
  | { kind: 'rotated'; userId: string; issued: IssuedRefreshToken }
  | { kind: 'invalid' }
  | { kind: 'revoked'; userId: string; familyId: string };

/**
 * B4 — refresh tokens (2026-10-23-01 migration).
 *
 *  issue   -> on login/register: a new family (= session, the `sid`) with its
 *             first token.
 *  rotate  -> POST /auth/refresh: the presented token is replaced by a new one
 *             in the same family. Presenting a token that was ALREADY rotated
 *             means two parties hold the chain (stolen token, or the client
 *             lost a response): the whole family is revoked.
 *  revoke  -> POST /auth/logout: the whole family.
 *
 * havit.refresh_token_families is the single source of truth of a session:
 * JwtAuthGuard and rotate() read its revoked_at / expires_at. Rotation and
 * revocation serialize on that row (post-audit B4-02-F01): rotate() locks it
 * FOR UPDATE before touching the token, and every revocation is an UPDATE of
 * it. Before, the state was spread over N token rows and a logout racing a
 * rotation missed the successor the rotation was inserting (READ COMMITTED
 * doesn't show a statement rows committed after it started), leaving the
 * session alive after a 204. Lock order everywhere: family, then its tokens.
 */
@Injectable()
export class RefreshTokensService {
  private readonly logger = new Logger(RefreshTokensService.name);

  constructor(@InjectDataSource() private dataSource: DataSource) {}

  /** Login/registration: a new family (session) and its first token. */
  async issue(userId: string): Promise<IssuedRefreshToken> {
    return this.dataSource.transaction(async (manager) => {
      const familyId = randomUUID();
      const expiresAt = this.nextExpiry();
      await manager.query(
        `INSERT INTO havit.refresh_token_families (id, user_id, expires_at)
         VALUES ($1, $2, $3)`,
        [familyId, userId, expiresAt],
      );
      const { refreshToken } = await this.insertToken(
        manager,
        userId,
        familyId,
        expiresAt,
      );
      return { refreshToken, familyId, expiresAt };
    });
  }

  /**
   * Exchanges a refresh token for a new one (same family). Throws the same
   * 401 for unknown, expired, revoked and reused tokens and for accounts that
   * are no longer usable — the revocations are committed before it throws.
   */
  async rotate(
    presented: string,
  ): Promise<{ userId: string; issued: IssuedRefreshToken }> {
    const hash = hashRefreshToken(presented);
    const outcome = await this.dataSource.transaction(
      async (manager): Promise<RotateOutcome> => {
        // 1. Which family? No lock yet: the family must be locked first.
        const found: Array<{ family_id: string }> = await manager.query(
          `SELECT family_id FROM havit.refresh_tokens WHERE token_hash = $1`,
          [hash],
        );
        if (!found[0]) return { kind: 'invalid' };
        const familyId = found[0].family_id;

        // 2. Lock the session. A concurrent revocation (an UPDATE of this
        // row) either committed before — then revoked_at is set here — or
        // waits until this rotation committed, and then revokes the family
        // the successor belongs to as well.
        const families: FamilyRow[] = await manager.query(
          `SELECT f.id, f.user_id, f.revoked_at, u.is_active, u.deleted_at
           FROM havit.refresh_token_families f
           JOIN havit.users u ON u.id = f.user_id
           WHERE f.id = $1
           FOR UPDATE OF f`,
          [familyId],
        );
        const family = families[0];
        if (!family || family.revoked_at) return { kind: 'invalid' };

        // 3. Re-read the token under the family lock: a concurrent rotation
        // of the same token that committed while we waited shows here as
        // replaced_by (reuse), or the cleanup may have deleted it.
        const tokens: TokenRow[] = await manager.query(
          `SELECT id, expires_at, replaced_by FROM havit.refresh_tokens
           WHERE token_hash = $1 AND family_id = $2
           FOR UPDATE`,
          [hash, familyId],
        );
        const token = tokens[0];
        if (!token) return { kind: 'invalid' };

        if (token.replaced_by) {
          await this.revokeFamilyWith(manager, familyId, 'reuse');
          this.logger.warn(`refresh token reuse: family ${familyId} revoked`);
          return { kind: 'revoked', userId: family.user_id, familyId };
        }

        if (new Date(token.expires_at).getTime() <= Date.now()) {
          return { kind: 'invalid' };
        }

        // Banned or purged since the last refresh: the session ends here.
        if (!family.is_active || family.deleted_at) {
          await this.revokeFamilyWith(manager, familyId, 'account');
          return { kind: 'revoked', userId: family.user_id, familyId };
        }

        // 4. Successor, old token marked as replaced, sliding expiry: one
        // transaction, so a failure leaves the presented token unused.
        const expiresAt = this.nextExpiry();
        const next = await this.insertToken(
          manager,
          family.user_id,
          familyId,
          expiresAt,
        );
        await manager.query(
          `UPDATE havit.refresh_tokens SET replaced_by = $2 WHERE id = $1`,
          [token.id, next.id],
        );
        await manager.query(
          `UPDATE havit.refresh_token_families SET expires_at = $2 WHERE id = $1`,
          [familyId, expiresAt],
        );
        return {
          kind: 'rotated',
          userId: family.user_id,
          issued: { refreshToken: next.refreshToken, familyId, expiresAt },
        };
      },
    );

    if (outcome.kind === 'revoked') {
      JwtAuthGuard.forgetSession(outcome.familyId);
    }
    if (outcome.kind !== 'rotated') {
      throw new UnauthorizedException(INVALID_REFRESH_TOKEN);
    }
    return { userId: outcome.userId, issued: outcome.issued };
  }

  /**
   * Logout: revokes the family of `presented` (any token of the chain).
   * Returns the family it revoked, or null if the token is unknown or the
   * family was already revoked.
   */
  async revokeByToken(
    presented: string,
    reason: RevokeReason = 'logout',
  ): Promise<{ userId: string; familyId: string } | null> {
    const revoked = await this.dataSource.transaction(async (manager) => {
      const found: Array<{ family_id: string }> = await manager.query(
        `SELECT family_id FROM havit.refresh_tokens WHERE token_hash = $1`,
        [hashRefreshToken(presented)],
      );
      if (!found[0]) return null;
      return this.revokeFamilyWith(manager, found[0].family_id, reason);
    });
    if (!revoked) return null;
    JwtAuthGuard.forgetSession(revoked.familyId);
    return revoked;
  }

  /**
   * Revokes a family: first its row (the lock rotate() also takes, and the
   * state the guard reads), then the audit copy on its tokens. Null when it
   * was already revoked (or doesn't exist).
   */
  private async revokeFamilyWith(
    manager: EntityManager,
    familyId: string,
    reason: RevokeReason,
  ): Promise<{ userId: string; familyId: string } | null> {
    // TypeORM answers an UPDATE with [rows, affectedCount].
    const [rows]: [Array<{ user_id: string }>, number] = await manager.query(
      `UPDATE havit.refresh_token_families
       SET revoked_at = now(), revoke_reason = $2
       WHERE id = $1 AND revoked_at IS NULL
       RETURNING user_id`,
      [familyId, reason],
    );
    if (!rows[0]) return null;
    await manager.query(
      `UPDATE havit.refresh_tokens
       SET revoked_at = now(), revoke_reason = $2
       WHERE family_id = $1 AND revoked_at IS NULL`,
      [familyId, reason],
    );
    return { userId: rows[0].user_id, familyId };
  }

  private nextExpiry(): Date {
    return new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * DAY_MS);
  }

  private async insertToken(
    manager: EntityManager,
    userId: string,
    familyId: string,
    expiresAt: Date,
  ): Promise<{ id: string; refreshToken: string }> {
    const refreshToken = randomBytes(32).toString('base64url');
    const rows: Array<{ id: string }> = await manager.query(
      `INSERT INTO havit.refresh_tokens (user_id, family_id, token_hash, expires_at)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [userId, familyId, hashRefreshToken(refreshToken), expiresAt],
    );
    return { id: rows[0].id, refreshToken };
  }

  /**
   * Daily cleanup, a day after expiry:
   *  1. expired families (their tokens go with them, ON DELETE CASCADE);
   *  2. expired tokens of families still alive (the old links of a chain
   *     that keeps rotating). Their family is locked first, as everywhere
   *     else (SKIP LOCKED: one being rotated right now waits for tomorrow).
   * An expired token is useless whatever its state, so nothing is lost; a
   * deleted one presented again is just unknown (401).
   */
  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async deleteExpired(): Promise<number> {
    try {
      return await this.dataSource.transaction(async (manager) => {
        // TypeORM answers a DELETE with [rows, affectedCount].
        const [, families]: [unknown[], number] = await manager.query(
          `DELETE FROM havit.refresh_token_families
           WHERE expires_at < now() - make_interval(days => $1)`,
          [CLEANUP_GRACE_DAYS],
        );
        const [, tokens]: [unknown[], number] = await manager.query(
          `WITH locked AS (
             SELECT f.id FROM havit.refresh_token_families f
             WHERE f.id IN (
               SELECT family_id FROM havit.refresh_tokens
               WHERE expires_at < now() - make_interval(days => $1)
             )
             FOR UPDATE SKIP LOCKED
           )
           DELETE FROM havit.refresh_tokens t
           USING locked
           WHERE t.family_id = locked.id
             AND t.expires_at < now() - make_interval(days => $1)`,
          [CLEANUP_GRACE_DAYS],
        );
        const deleted = families + tokens;
        if (deleted) {
          this.logger.log(
            `deleted ${families} expired sessions and ${tokens} expired refresh tokens`,
          );
        }
        return deleted;
      });
    } catch (error) {
      this.logger.error(
        `refresh token cleanup failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return 0;
    }
  }
}
