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

interface TokenRow {
  id: string;
  user_id: string;
  family_id: string;
  expires_at: Date;
  revoked_at: Date | null;
  replaced_by: string | null;
  is_active: boolean;
  deleted_at: Date | null;
}

type RotateOutcome =
  | { kind: 'rotated'; userId: string; issued: IssuedRefreshToken }
  | { kind: 'invalid' }
  | { kind: 'revoked'; userId: string; familyId: string };

/**
 * B4 — refresh tokens (havit.refresh_tokens, 2026-10-23-01 migration).
 *
 *  issue   -> on login/register: a new family (= session) with its first token.
 *  rotate  -> POST /auth/refresh: the presented token is replaced by a new one
 *             in the same family. Presenting a token that was ALREADY rotated
 *             means two parties hold the chain (stolen token, or the client
 *             lost a response): the whole family is revoked.
 *  revoke  -> POST /auth/logout: the whole family.
 *
 * JwtAuthGuard treats a family as alive while its head (the one row with
 * replaced_by IS NULL) is neither revoked nor expired.
 */
@Injectable()
export class RefreshTokensService {
  private readonly logger = new Logger(RefreshTokensService.name);

  constructor(@InjectDataSource() private dataSource: DataSource) {}

  async issue(
    userId: string,
    familyId: string = randomUUID(),
    manager: EntityManager = this.dataSource.manager,
  ): Promise<IssuedRefreshToken & { id: string }> {
    const refreshToken = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * DAY_MS);
    const rows: Array<{ id: string }> = await manager.query(
      `INSERT INTO havit.refresh_tokens (user_id, family_id, token_hash, expires_at)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [userId, familyId, hashRefreshToken(refreshToken), expiresAt],
    );
    return { id: rows[0].id, refreshToken, familyId, expiresAt };
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
        // FOR UPDATE: two requests with the same token are serialized; the
        // second one sees the first one's replaced_by and counts as reuse.
        const rows: TokenRow[] = await manager.query(
          `SELECT t.id, t.user_id, t.family_id, t.expires_at, t.revoked_at,
                  t.replaced_by, u.is_active, u.deleted_at
           FROM havit.refresh_tokens t
           JOIN havit.users u ON u.id = t.user_id
           WHERE t.token_hash = $1
           FOR UPDATE OF t`,
          [hash],
        );
        const row = rows[0];
        if (!row || row.revoked_at) return { kind: 'invalid' };

        if (row.replaced_by) {
          await this.revokeFamilyWith(manager, row.family_id, 'reuse');
          this.logger.warn(
            `refresh token reuse: family ${row.family_id} revoked`,
          );
          return {
            kind: 'revoked',
            userId: row.user_id,
            familyId: row.family_id,
          };
        }

        if (new Date(row.expires_at).getTime() <= Date.now()) {
          return { kind: 'invalid' };
        }

        // Banned or purged since the last refresh: the session ends here.
        if (!row.is_active || row.deleted_at) {
          await this.revokeFamilyWith(manager, row.family_id, 'account');
          return {
            kind: 'revoked',
            userId: row.user_id,
            familyId: row.family_id,
          };
        }

        const next = await this.issue(row.user_id, row.family_id, manager);
        await manager.query(
          `UPDATE havit.refresh_tokens SET replaced_by = $2 WHERE id = $1`,
          [row.id, next.id],
        );
        return {
          kind: 'rotated',
          userId: row.user_id,
          issued: {
            refreshToken: next.refreshToken,
            familyId: next.familyId,
            expiresAt: next.expiresAt,
          },
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
    // TypeORM answers an UPDATE with [rows, affectedCount].
    const [rows]: [Array<{ user_id: string; family_id: string }>, number] =
      await this.dataSource.query(
        `UPDATE havit.refresh_tokens
         SET revoked_at = now(), revoke_reason = $2
         WHERE family_id = (
           SELECT family_id FROM havit.refresh_tokens WHERE token_hash = $1
         )
           AND revoked_at IS NULL
         RETURNING user_id, family_id`,
        [hashRefreshToken(presented), reason],
      );
    if (!rows[0]) return null;
    JwtAuthGuard.forgetSession(rows[0].family_id);
    return { userId: rows[0].user_id, familyId: rows[0].family_id };
  }

  async revokeFamily(familyId: string, reason: RevokeReason): Promise<void> {
    await this.revokeFamilyWith(this.dataSource.manager, familyId, reason);
    JwtAuthGuard.forgetSession(familyId);
  }

  private async revokeFamilyWith(
    manager: EntityManager,
    familyId: string,
    reason: RevokeReason,
  ): Promise<void> {
    await manager.query(
      `UPDATE havit.refresh_tokens
       SET revoked_at = now(), revoke_reason = $2
       WHERE family_id = $1 AND revoked_at IS NULL`,
      [familyId, reason],
    );
  }

  /**
   * Daily cleanup. An expired token is useless whatever its state (rotated,
   * revoked or head), so nothing is lost by deleting it.
   */
  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async deleteExpired(): Promise<number> {
    try {
      // TypeORM answers a DELETE with [rows, affectedCount].
      const [, deleted]: [unknown[], number] = await this.dataSource.query(
        `DELETE FROM havit.refresh_tokens
         WHERE expires_at < now() - make_interval(days => $1)`,
        [CLEANUP_GRACE_DAYS],
      );
      if (deleted) this.logger.log(`deleted ${deleted} expired refresh tokens`);
      return deleted;
    } catch (error) {
      this.logger.error(
        `refresh token cleanup failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return 0;
    }
  }
}
