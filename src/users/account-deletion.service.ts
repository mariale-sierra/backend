import {
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
  ConflictException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { createHash, randomBytes } from 'crypto';
import * as bcrypt from 'bcrypt';
import { DataSource, EntityManager } from 'typeorm';
import { UploadsService } from '../uploads/uploads.service';

/** Days an account stays recoverable between the request and the purge. */
export const ACCOUNT_DELETION_GRACE_DAYS = 30;

type AuditEvent = 'requested' | 'cancelled' | 'completed' | 'failed';

/**
 * Account deletion (B2).
 *
 *  request  -> deletion_requested_at / deletion_scheduled_for (now + grace),
 *              audit 'requested'. The user can still log in and cancel.
 *  cancel   -> clears both, audit 'cancelled'.
 *  purge    -> runs from a cron for every account past its scheduled date:
 *              deletes personal data, anonymizes the users row, audit
 *              'completed' (or 'failed', retried next run).
 *
 * The users row itself is kept (anonymized, is_active=false, deleted_at set)
 * because moderation records (reports, penalties) and challenges/spaces/
 * routines the user created reference it; it no longer holds anything that
 * identifies a person. Content authored in shared places (posts, comments,
 * chat messages) is deleted, not left under an anonymous name.
 */
@Injectable()
export class AccountDeletionService {
  private readonly logger = new Logger(AccountDeletionService.name);

  constructor(
    @InjectDataSource() private dataSource: DataSource,
    private uploadsService: UploadsService,
  ) {}

  async requestDeletion(userId: string, password: string) {
    const rows: Array<{
      email: string;
      password_hash: string;
      deletion_requested_at: Date | null;
      deleted_at: Date | null;
    }> = await this.dataSource.query(
      `SELECT email, password_hash, deletion_requested_at, deleted_at
       FROM havit.users WHERE id = $1`,
      [userId],
    );
    const user = rows[0];
    if (!user || user.deleted_at) throw new NotFoundException('User not found');

    if (!(await bcrypt.compare(password, user.password_hash))) {
      throw new UnauthorizedException('Invalid password');
    }
    if (user.deletion_requested_at) {
      throw new ConflictException('Account deletion already requested');
    }

    const now = new Date();
    const scheduledFor = new Date(
      now.getTime() + ACCOUNT_DELETION_GRACE_DAYS * 24 * 60 * 60 * 1000,
    );

    await this.dataSource.transaction(async (manager) => {
      await manager.query(
        `UPDATE havit.users
         SET deletion_requested_at = $2, deletion_scheduled_for = $3
         WHERE id = $1`,
        [userId, now, scheduledFor],
      );
      await this.audit(manager, userId, 'requested', user.email, {
        scheduled_for: scheduledFor.toISOString(),
        grace_days: ACCOUNT_DELETION_GRACE_DAYS,
      });
    });

    return {
      message: 'Account deletion requested',
      deletion_requested_at: now,
      deletion_scheduled_for: scheduledFor,
    };
  }

  async cancelDeletion(userId: string) {
    const cancelled = await this.dataSource.transaction(async (manager) => {
      const rows: Array<{ email: string }> = await manager.query(
        `UPDATE havit.users
         SET deletion_requested_at = NULL, deletion_scheduled_for = NULL
         WHERE id = $1 AND deletion_requested_at IS NOT NULL AND deleted_at IS NULL
         RETURNING email`,
        [userId],
      );
      if (rows.length === 0) return false;
      await this.audit(manager, userId, 'cancelled', rows[0].email);
      return true;
    });
    if (!cancelled) {
      throw new NotFoundException('No pending account deletion request');
    }
    return { message: 'Account deletion cancelled' };
  }

  async getStatus(userId: string) {
    const rows: Array<{
      deletion_requested_at: Date | null;
      deletion_scheduled_for: Date | null;
    }> = await this.dataSource.query(
      `SELECT deletion_requested_at, deletion_scheduled_for
       FROM havit.users WHERE id = $1 AND deleted_at IS NULL`,
      [userId],
    );
    if (rows.length === 0) throw new NotFoundException('User not found');
    return {
      pending: rows[0].deletion_requested_at !== null,
      deletion_requested_at: rows[0].deletion_requested_at,
      deletion_scheduled_for: rows[0].deletion_scheduled_for,
    };
  }

  @Cron(CronExpression.EVERY_HOUR)
  async purgeDueAccounts(): Promise<number> {
    const due: Array<{ id: string }> = await this.dataSource.query(
      `SELECT id FROM havit.users
       WHERE deletion_scheduled_for <= now() AND deleted_at IS NULL
       ORDER BY deletion_scheduled_for
       LIMIT 50`,
    );

    let purged = 0;
    for (const { id } of due) {
      try {
        await this.purgeAccount(id);
        purged++;
      } catch (error) {
        // Left untouched (still due) so the next run retries it.
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`Account purge failed for ${id}: ${message}`);
        await this.dataSource
          .transaction((manager) =>
            this.audit(manager, id, 'failed', undefined, { error: message }),
          )
          .catch(() => undefined);
      }
    }
    return purged;
  }

  /**
   * Photos go first: if R2 fails we abort before touching the database, so a
   * retry still knows which user to clean. The DB side is one transaction —
   * either everything is purged and the audit row written, or nothing is.
   */
  async purgeAccount(userId: string): Promise<void> {
    const deletedObjects = await this.uploadsService.deleteUserObjects(userId);

    await this.dataSource.transaction(async (manager) => {
      const rows: Array<{ email: string }> = await manager.query(
        `SELECT email FROM havit.users
         WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
        [userId],
      );
      if (rows.length === 0) return;
      const { email } = rows[0];

      // Likes/comments on the user's posts go with the posts (ON DELETE
      // CASCADE); the rest are listed explicitly. workout_posts must go
      // before workout_logs (FK), the order of the others is irrelevant.
      const purgeTables: Array<[string, string]> = [
        ['workout_posts', 'user_id'],
        ['workout_post_comments', 'user_id'],
        ['workout_post_likes', 'user_id'],
        ['workout_logs', 'user_id'],
        ['user_follows', 'follower_user_id'],
        ['user_follows', 'followed_user_id'],
        ['challenge_user_map', 'user_id'],
        ['challenge_invites', 'sender_user_id'],
        ['challenge_invites', 'recipient_user_id'],
        ['challenge_join_requests', 'user_id'],
        ['space_members', 'user_id'],
        ['space_join_requests', 'user_id'],
        ['space_messages', 'user_id'],
        ['direct_messages', 'user_id'],
        ['direct_conversation_members', 'user_id'],
        ['notifications', 'recipient_user_id'],
      ];
      for (const [table, column] of purgeTables) {
        await manager.query(`DELETE FROM havit.${table} WHERE ${column} = $1`, [
          userId,
        ]);
      }
      await manager.query(
        `UPDATE havit.notifications SET actor_user_id = NULL WHERE actor_user_id = $1`,
        [userId],
      );

      await manager.query(
        `UPDATE havit.user_profiles
         SET display_name = 'Deleted user', bio = NULL,
             profile_image_url = NULL, is_private = true,
             practice_preferences = '{}'
         WHERE user_id = $1`,
        [userId],
      );

      const shortId = userId.replace(/-/g, '').slice(0, 12);
      await manager.query(
        `UPDATE havit.users
         SET username = $2, email = $3, password_hash = $4,
             is_active = false, is_admin = false,
             terms_accepted_at = NULL, terms_version = NULL,
             age_confirmed_at = NULL,
             deletion_scheduled_for = NULL, deleted_at = now()
         WHERE id = $1`,
        [
          userId,
          `deleted_${shortId}`,
          `deleted+${userId}@deleted.invalid`,
          // Not a valid bcrypt hash: nobody can ever log in again.
          `!${randomBytes(24).toString('hex')}`,
        ],
      );

      await this.audit(manager, userId, 'completed', email, {
        r2_objects_deleted: deletedObjects,
      });
    });
  }

  private audit(
    manager: EntityManager,
    userId: string,
    event: AuditEvent,
    email?: string,
    details: Record<string, unknown> = {},
  ) {
    const emailHash = email
      ? createHash('sha256').update(email.trim().toLowerCase()).digest('hex')
      : null;
    return manager.query(
      `INSERT INTO havit.account_deletion_audit (user_id, event, email_sha256, details)
       VALUES ($1, $2, $3, $4::jsonb)`,
      [userId, event, emailHash, JSON.stringify(details)],
    );
  }
}
