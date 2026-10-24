import { ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { DataSource, EntityManager } from 'typeorm';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import {
  INVALID_REFRESH_TOKEN,
  RefreshTokensService,
} from './refresh-tokens.service';

/**
 * B4 (post-audit B4-02-F01) — revocation vs. rotation under REAL concurrency,
 * against a throwaway Postgres that already has every database/ migration
 * applied. Skipped unless B2_TEST_DB_URL is set, e.g.
 *   B2_TEST_DB_URL=postgres://user:pass@localhost:5432/havit_b4_test npx jest refresh-tokens.integration
 * NEVER point it at a shared database: it inserts and deletes rows.
 *
 * Deterministic interleaving: a rotation is held open right after it inserted
 * the successor token (before its COMMIT), the competing logout / reuse is
 * started and the test waits until Postgres reports it blocked on a lock
 * (pg_stat_activity), and only then is the rotation released.
 */
const dbUrl = process.env.B2_TEST_DB_URL;
const describeDb = dbUrl ? describe : describe.skip;

const SECRET = 'refresh-tokens-integration-secret';

type Held = {
  /** Resolves once the held rotation inserted the successor (not committed). */
  reached: Promise<void>;
  release: () => void;
};

describeDb('RefreshTokensService concurrency (real Postgres)', () => {
  let ds: DataSource;
  let service: RefreshTokensService;
  let guard: JwtAuthGuard;
  const jwt = new JwtService({});

  const createUser = async () => {
    const id = randomUUID();
    await ds.query(
      `INSERT INTO havit.users (id, username, email, password_hash)
       VALUES ($1, $2, $3, 'x')`,
      [id, `rt_${id.slice(0, 8)}`, `${id}@example.com`],
    );
    return id;
  };

  /** Would JwtAuthGuard let an access token of this session through right now? */
  const guardAccepts = async (userId: string, sid: string) => {
    JwtAuthGuard.clearSessionCache();
    const token = await jwt.signAsync(
      { sub: userId, email: 'x@example.com', username: 'x', sid },
      { secret: SECRET, expiresIn: 900 },
    );
    const request = { headers: { authorization: `Bearer ${token}` } };
    const context = {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
    return guard.canActivate(context).then(
      () => true,
      () => false,
    );
  };

  const rejectsAsInvalid = (refreshToken: string) =>
    expect(service.rotate(refreshToken)).rejects.toThrow(INVALID_REFRESH_TOKEN);

  /**
   * Makes the NEXT `ds.transaction` (the operation under test) pause right
   * after the statement matching `after` — by default the rotation's INSERT
   * of the successor token — holding its locks. With `fail`, it throws there
   * instead (a crash in the middle).
   */
  const holdNextTransaction = ({
    fail = false,
    after = /^\s*INSERT INTO havit\.refresh_tokens\b/,
  } = {}): Held => {
    let release: () => void = () => undefined;
    let reached: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const reachedPromise = new Promise<void>((resolve) => (reached = resolve));
    const original = ds.transaction.bind(ds) as (
      cb: (m: EntityManager) => Promise<unknown>,
    ) => Promise<unknown>;

    jest.spyOn(ds, 'transaction').mockImplementationOnce(((
      cb: (m: EntityManager) => Promise<unknown>,
    ) =>
      original((manager) => {
        const proxy = new Proxy(manager, {
          get(target, prop, receiver) {
            if (prop === 'query') {
              return async (sql: string, params?: unknown[]) => {
                const result: unknown = await target.query(sql, params);
                if (after.test(sql)) {
                  reached();
                  if (fail) throw new Error('crash after inserting successor');
                  await gate;
                }
                return result;
              };
            }
            const value: unknown = Reflect.get(target, prop, receiver);
            return typeof value === 'function'
              ? ((value as (...a: unknown[]) => unknown).bind(
                  target,
                ) as unknown)
              : value;
          },
        });
        return cb(proxy);
      })) as unknown as typeof ds.transaction);

    return { reached: reachedPromise, release };
  };

  /** Waits until at least one session of this database is blocked on a lock. */
  const waitForLockWaiter = async () => {
    for (let i = 0; i < 200; i += 1) {
      const [{ waiting }]: Array<{ waiting: number }> = await ds.query(
        `SELECT count(*)::int AS waiting FROM pg_stat_activity
         WHERE datname = current_database() AND wait_event_type = 'Lock'`,
      );
      if (waiting > 0) return;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error('the competing statement never blocked on a lock');
  };

  beforeAll(async () => {
    ds = new DataSource({
      type: 'postgres',
      url: dbUrl,
      schema: 'havit',
      extra: { max: 10 },
    });
    await ds.initialize();
    service = new RefreshTokensService(ds);
    guard = new JwtAuthGuard(
      jwt,
      { getOrThrow: () => SECRET } as unknown as ConfigService,
      { getAllAndOverride: () => false } as unknown as Reflector,
      ds,
    );
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(async () => {
    await ds?.destroy();
  });

  it('a logout that runs while the same family is being rotated leaves no live successor', async () => {
    const userId = await createUser();
    const first = await service.issue(userId);

    const held = holdNextTransaction();
    const rotation = service.rotate(first.refreshToken);
    await held.reached;
    const logout = service.revokeByToken(first.refreshToken);
    await waitForLockWaiter();
    held.release();

    const { issued: successor } = await rotation;
    await logout;

    // The logout answered 204 to the client: nothing of that session may renew.
    await rejectsAsInvalid(successor.refreshToken);
    await rejectsAsInvalid(first.refreshToken);
    expect(await guardAccepts(userId, first.familyId)).toBe(false);
  });

  it('a reuse detected while the head is being rotated revokes the successor too', async () => {
    const userId = await createUser();
    const r0 = await service.issue(userId);
    const { issued: r1 } = await service.rotate(r0.refreshToken);

    const held = holdNextTransaction();
    const headRotation = service.rotate(r1.refreshToken);
    await held.reached;
    // Someone replays the already-rotated r0 at the same time.
    const reuse = service.rotate(r0.refreshToken).then(
      () => 'rotated',
      (e: Error) => e.message,
    );
    await waitForLockWaiter();
    held.release();

    const { issued: r2 } = await headRotation;
    expect(await reuse).toBe(INVALID_REFRESH_TOKEN);

    await rejectsAsInvalid(r2.refreshToken);
    expect(await guardAccepts(userId, r0.familyId)).toBe(false);
  });

  it('a rotation that arrives while a logout is still uncommitted waits for it and is refused', async () => {
    const userId = await createUser();
    const first = await service.issue(userId);

    const held = holdNextTransaction({
      after: /^\s*UPDATE havit\.refresh_token_families\b/,
    });
    const logout = service.revokeByToken(first.refreshToken);
    await held.reached;
    const rotation = service.rotate(first.refreshToken).then(
      () => 'rotated',
      (e: Error) => e.message,
    );
    await waitForLockWaiter();
    held.release();

    await expect(logout).resolves.toEqual({ userId, familyId: first.familyId });
    expect(await rotation).toBe(INVALID_REFRESH_TOKEN);
    expect(await guardAccepts(userId, first.familyId)).toBe(false);
  });

  it('the guard stops accepting a revoked session on this process without waiting for its cache', async () => {
    const userId = await createUser();
    const first = await service.issue(userId);
    expect(await guardAccepts(userId, first.familyId)).toBe(true);

    // Cache warm ("usable" for 30 s) — then the logout commits here.
    const token = await jwt.signAsync(
      {
        sub: userId,
        email: 'x@example.com',
        username: 'x',
        sid: first.familyId,
      },
      { secret: SECRET, expiresIn: 900 },
    );
    const context = {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({
        getRequest: () => ({ headers: { authorization: `Bearer ${token}` } }),
      }),
    } as unknown as ExecutionContext;
    await expect(guard.canActivate(context)).resolves.toBe(true);
    await service.revokeByToken(first.refreshToken);
    await expect(guard.canActivate(context)).rejects.toThrow(
      'Session is no longer valid',
    );
  });

  it('two refreshes with the same token: exactly one rotates and the family ends revoked', async () => {
    const userId = await createUser();
    const first = await service.issue(userId);

    const results = await Promise.allSettled([
      service.rotate(first.refreshToken),
      service.rotate(first.refreshToken),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual([
      'fulfilled',
      'rejected',
    ]);
    const winner = results.find((r) => r.status === 'fulfilled') as
      | PromiseFulfilledResult<Awaited<ReturnType<typeof service.rotate>>>
      | undefined;
    await rejectsAsInvalid(winner!.value.issued.refreshToken);
    expect(await guardAccepts(userId, first.familyId)).toBe(false);
  });

  it('a revoked family never comes back: no token of its chain renews, before or after', async () => {
    const userId = await createUser();
    const r0 = await service.issue(userId);
    const { issued: r1 } = await service.rotate(r0.refreshToken);

    await service.revokeByToken(r1.refreshToken);

    for (const token of [r1.refreshToken, r0.refreshToken, r1.refreshToken]) {
      await rejectsAsInvalid(token);
    }
    // Logging out again (or with the old token) changes nothing and revives nothing.
    await service.revokeByToken(r0.refreshToken);
    expect(await guardAccepts(userId, r0.familyId)).toBe(false);
  });

  it('two sessions of the same user stay isolated: revoking A during a rotation of B leaves B alive', async () => {
    const userId = await createUser();
    const a = await service.issue(userId);
    const b = await service.issue(userId);

    const held = holdNextTransaction();
    const rotationB = service.rotate(b.refreshToken);
    await held.reached;
    // A different family: must not wait on B's lock, nor touch B.
    await service.revokeByToken(a.refreshToken);
    held.release();
    const { issued: b2 } = await rotationB;

    await rejectsAsInvalid(a.refreshToken);
    expect(await guardAccepts(userId, a.familyId)).toBe(false);
    expect(await guardAccepts(userId, b.familyId)).toBe(true);
    await expect(service.rotate(b2.refreshToken)).resolves.toBeTruthy();
  });

  it('a crash in the middle of a rotation leaves nothing half-committed', async () => {
    const userId = await createUser();
    const first = await service.issue(userId);
    const before: unknown[] = await ds.query(
      `SELECT id, replaced_by, revoked_at FROM havit.refresh_tokens
       WHERE family_id = $1 ORDER BY created_at`,
      [first.familyId],
    );

    holdNextTransaction({ fail: true });
    await expect(service.rotate(first.refreshToken)).rejects.toThrow(
      'crash after inserting successor',
    );

    const after: unknown[] = await ds.query(
      `SELECT id, replaced_by, revoked_at FROM havit.refresh_tokens
       WHERE family_id = $1 ORDER BY created_at`,
      [first.familyId],
    );
    expect(after).toEqual(before);
    // The untouched token still works (it was never consumed).
    await expect(service.rotate(first.refreshToken)).resolves.toBeTruthy();
  });

  it('mixed concurrent rotations, reuses and logouts on one family never deadlock nor leave it alive', async () => {
    for (let round = 0; round < 15; round += 1) {
      const userId = await createUser();
      const r0 = await service.issue(userId);
      const { issued: r1 } = await service.rotate(r0.refreshToken);

      const outcomes = await Promise.allSettled([
        service.rotate(r1.refreshToken),
        service.rotate(r1.refreshToken),
        service.rotate(r0.refreshToken), // reuse
        service.revokeByToken(r1.refreshToken),
        service.revokeByToken(r0.refreshToken),
      ]);

      for (const outcome of outcomes) {
        if (outcome.status === 'rejected') {
          // Only the uniform 401 — never a deadlock (40P01) or another DB error.
          expect((outcome.reason as Error).message).toBe(INVALID_REFRESH_TOKEN);
        }
      }
      expect(await guardAccepts(userId, r0.familyId)).toBe(false);
      for (const outcome of outcomes) {
        const value = outcome.status === 'fulfilled' ? outcome.value : null;
        if (value && 'issued' in value) {
          await rejectsAsInvalid(value.issued.refreshToken);
        }
      }
    }
  });
});
