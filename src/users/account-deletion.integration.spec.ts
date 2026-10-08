import { DataSource } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { AccountDeletionService } from './account-deletion.service';
import { UploadsService } from '../uploads/uploads.service';

/**
 * Runs the real SQL of AccountDeletionService against a throwaway Postgres
 * that already has every database/ migration applied. Skipped unless
 * B2_TEST_DB_URL is set, e.g.
 *   B2_TEST_DB_URL=postgres://user:pass@localhost:5434/havit_b2_test npx jest account-deletion.integration
 * NEVER point it at a shared database: it inserts and deletes rows.
 */
const dbUrl = process.env.B2_TEST_DB_URL;
const describeDb = dbUrl ? describe : describe.skip;

describeDb('AccountDeletionService (real Postgres)', () => {
  let ds: DataSource;
  let service: AccountDeletionService;
  const uploads = { deleteUserObjects: jest.fn().mockResolvedValue(2) };

  const createUser = async (password = 'password123') => {
    const id = randomUUID();
    await ds.query(
      `INSERT INTO havit.users (id, username, email, password_hash)
       VALUES ($1, $2, $3, $4)`,
      [
        id,
        `u_${id.slice(0, 8)}`,
        `${id}@example.com`,
        await bcrypt.hash(password, 4),
      ],
    );
    await ds.query(
      `INSERT INTO havit.user_profiles (user_id, display_name, bio, preferred_language, profile_image_url)
       VALUES ($1, 'Real Name', 'my bio', 'es', 'https://img/me.jpg')`,
      [id],
    );
    return id;
  };

  beforeAll(async () => {
    ds = new DataSource({ type: 'postgres', url: dbUrl, schema: 'havit' });
    await ds.initialize();
    service = new AccountDeletionService(
      ds,
      uploads as unknown as UploadsService,
    );
  });

  afterAll(async () => {
    await ds?.destroy();
  });

  it('requires the right password, schedules 30 days out, audits, and can be cancelled', async () => {
    const id = await createUser();

    await expect(service.requestDeletion(id, 'wrong')).rejects.toThrow(
      'Invalid password',
    );

    const res = await service.requestDeletion(id, 'password123');
    const days =
      (res.deletion_scheduled_for.getTime() -
        res.deletion_requested_at.getTime()) /
      86_400_000;
    expect(days).toBe(30);
    await expect(service.requestDeletion(id, 'password123')).rejects.toThrow(
      'already requested',
    );

    await service.cancelDeletion(id);
    expect((await service.getStatus(id)).pending).toBe(false);

    const events = await ds.query(
      `SELECT event FROM havit.account_deletion_audit WHERE user_id = $1 ORDER BY id`,
      [id],
    );
    expect(events.map((e: { event: string }) => e.event)).toEqual([
      'requested',
      'cancelled',
    ]);
  });

  it('purges personal data and anonymizes the account once the grace period is over', async () => {
    const id = await createUser();
    const other = await createUser();

    const [{ id: logId }] = await ds.query(
      `INSERT INTO havit.workout_logs (user_id, started_at, status)
       VALUES ($1, now(), 'completed') RETURNING id`,
      [id],
    );
    const [{ id: postId }] = await ds.query(
      `INSERT INTO havit.workout_posts (workout_log_id, user_id, image_url, visibility)
       VALUES ($1, $2, 'https://img/p.jpg', 'public') RETURNING id`,
      [logId, id],
    );
    await ds.query(
      `INSERT INTO havit.workout_post_likes (workout_post_id, user_id) VALUES ($1, $2)`,
      [postId, other],
    );
    await ds.query(
      `INSERT INTO havit.user_follows (follower_user_id, followed_user_id) VALUES ($1, $2)`,
      [other, id],
    );
    // B3: push tokens, preferences and notifications (as recipient and as actor).
    await ds.query(
      `INSERT INTO havit.device_push_tokens (user_id, token, platform)
       VALUES ($1, $2, 'ios')`,
      [id, `ExponentPushToken[${id}]`],
    );
    await ds.query(
      `INSERT INTO havit.notification_preferences (user_id, notification_type_id, push_enabled)
       SELECT $1, id, false FROM havit.notification_types WHERE code = 'post_reaction'`,
      [id],
    );
    await ds.query(
      `INSERT INTO havit.notifications
         (recipient_user_id, actor_user_id, notification_type_id, related_entity_type, related_entity_id)
       SELECT $1::uuid, $2::uuid, id, 'user', $2::text FROM havit.notification_types WHERE code = 'new_follower'`,
      [id, other],
    );
    const [{ id: actorNotificationId }] = await ds.query(
      `INSERT INTO havit.notifications
         (recipient_user_id, actor_user_id, notification_type_id, related_entity_type, related_entity_id)
       SELECT $1::uuid, $2::uuid, id, 'user', $2::text FROM havit.notification_types WHERE code = 'new_follower'
       RETURNING id`,
      [other, id],
    );

    await service.requestDeletion(id, 'password123');
    // Not due yet: the cron must leave it alone.
    await service.purgeDueAccounts();
    expect(
      (
        await ds.query(`SELECT deleted_at FROM havit.users WHERE id = $1`, [id])
      )[0].deleted_at,
    ).toBeNull();

    await ds.query(
      `UPDATE havit.users SET deletion_scheduled_for = now() - interval '1 minute' WHERE id = $1`,
      [id],
    );
    expect(await service.purgeDueAccounts()).toBeGreaterThanOrEqual(1);

    const count = async (sql: string) =>
      Number((await ds.query(sql, [id]))[0].n);
    expect(
      await count(
        `SELECT count(*) n FROM havit.workout_posts WHERE user_id = $1`,
      ),
    ).toBe(0);
    expect(
      await count(
        `SELECT count(*) n FROM havit.workout_logs WHERE user_id = $1`,
      ),
    ).toBe(0);
    expect(
      await count(
        `SELECT count(*) n FROM havit.user_follows WHERE followed_user_id = $1`,
      ),
    ).toBe(0);
    expect(
      Number(
        (
          await ds.query(
            `SELECT count(*) n FROM havit.workout_post_likes WHERE workout_post_id = $1`,
            [postId],
          )
        )[0].n,
      ),
    ).toBe(0);
    expect(
      await count(
        `SELECT count(*) n FROM havit.device_push_tokens WHERE user_id = $1`,
      ),
    ).toBe(0);
    expect(
      await count(
        `SELECT count(*) n FROM havit.notification_preferences WHERE user_id = $1`,
      ),
    ).toBe(0);
    expect(
      await count(
        `SELECT count(*) n FROM havit.notifications WHERE recipient_user_id = $1`,
      ),
    ).toBe(0);
    // The other user's notification survives, with the actor anonymized.
    const [actorNotification] = await ds.query(
      `SELECT actor_user_id FROM havit.notifications WHERE id = $1`,
      [actorNotificationId],
    );
    expect(actorNotification.actor_user_id).toBeNull();

    const [user] = await ds.query(`SELECT * FROM havit.users WHERE id = $1`, [
      id,
    ]);
    expect(user.deleted_at).not.toBeNull();
    expect(user.is_active).toBe(false);
    expect(user.email).toBe(`deleted+${id}@deleted.invalid`);
    expect(user.username).toMatch(/^deleted_/);
    expect(
      await bcrypt
        .compare('password123', user.password_hash)
        .catch(() => false),
    ).toBe(false);

    const [profile] = await ds.query(
      `SELECT * FROM havit.user_profiles WHERE user_id = $1`,
      [id],
    );
    expect(profile.bio).toBeNull();
    expect(profile.profile_image_url).toBeNull();

    // The other user is untouched.
    expect(
      (
        await ds.query(`SELECT deleted_at FROM havit.users WHERE id = $1`, [
          other,
        ])
      )[0].deleted_at,
    ).toBeNull();

    expect(uploads.deleteUserObjects).toHaveBeenCalledWith(id);
    const audit = await ds.query(
      `SELECT event, email_sha256, details FROM havit.account_deletion_audit WHERE user_id = $1 ORDER BY id`,
      [id],
    );
    expect(audit.map((a: { event: string }) => a.event)).toEqual([
      'requested',
      'completed',
    ]);
    expect(audit[1].email_sha256).toHaveLength(64);
    expect(audit[1].details.r2_objects_deleted).toBe(2);
  });

  it('records a failure and keeps the account due when R2 deletion fails', async () => {
    const id = await createUser();
    await service.requestDeletion(id, 'password123');
    await ds.query(
      `UPDATE havit.users SET deletion_scheduled_for = now() - interval '1 minute' WHERE id = $1`,
      [id],
    );
    uploads.deleteUserObjects.mockRejectedValueOnce(new Error('r2 down'));

    await service.purgeDueAccounts();

    const [user] = await ds.query(
      `SELECT deleted_at, email FROM havit.users WHERE id = $1`,
      [id],
    );
    expect(user.deleted_at).toBeNull();
    expect(user.email).toBe(`${id}@example.com`);
    const events = await ds.query(
      `SELECT event, details FROM havit.account_deletion_audit WHERE user_id = $1 ORDER BY id`,
      [id],
    );
    expect(events.map((e: { event: string }) => e.event)).toEqual([
      'requested',
      'failed',
    ]);
    expect(events[1].details.error).toBe('r2 down');
  });
});
