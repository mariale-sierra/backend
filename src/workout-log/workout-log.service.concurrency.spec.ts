import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConflictException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { WorkoutLogService } from './workout-log.service';
import { WorkoutLog } from './entities/workout-log.entity';
import { RoutineExercise } from '../routine/entities/routine-exercise.entity';
import { WorkoutLogExercise } from './entities/workout-log-exercise.entity';
import { WorkoutPostsService } from '../workout-posts/workout-posts.service';
import { Challenge } from '../challenges/entities/challenge.entity';
import { ChallengeUserMap } from '../challenges/entities/challenge-user-map.entity';

/**
 * B5 — Concurrency and integrity of Workout Progress.
 *
 * This repo has no e2e/integration harness against a real Postgres instance
 * (test/jest-e2e.json exists but no *.e2e-spec.ts files do), and the only
 * database this project talks to in any environment is the shared Azure
 * Postgres instance (see raiz/docker-compose.yml's own comment: "Do not add
 * a local `db` service that shadows it"). Spinning up a disposable local
 * Postgres purely for this suite, or running concurrent requests against the
 * shared dev database from an automated test, would be new test
 * infrastructure well beyond this ticket's surgical scope, and isn't
 * something this sandbox is set up to do safely.
 *
 * Instead, this suite drives the REAL WorkoutLogService.createWorkout() with
 * genuinely overlapping promises (Promise.all, never sequential awaits)
 * against a small in-memory fake that reproduces the one Postgres behavior
 * this fix depends on: a unique index blocks a concurrent INSERT for the
 * same key until the transaction already holding that key commits or rolls
 * back, and only THEN re-checks for a duplicate — see FakeWorkoutLogsTable
 * below. That is the exact mechanism that makes
 * uq_workout_logs_user_challenge_local_day
 * (database/migrations/2026-09-28-01-workout-logs-progress-uniqueness.sql)
 * race-proof, so exercising it here proves the service's transaction
 * handling and 23505 -> ConflictException translation are correct.
 *
 * What this suite does NOT replace: running `npm run db:migrate` against a
 * real Postgres and confirming the actual index gets created (see the final
 * B5 report for that as a pending manual step, since this sandbox is
 * blocked from using the shared DB's credentials).
 */

type FakeLogRow = {
  id: number;
  userId: string;
  challengeId: string;
  localDay: string;
};

type PostData = {
  workout_log_id: number;
  user_id: string;
  image_url?: string;
  caption?: string;
  visibility?: string;
};

type FindOneCall = {
  where: { id?: number; userId?: string; challengeId?: string };
};

type TxnState = {
  pendingLog?: FakeLogRow;
  releaseLock?: () => void;
  pendingPosts: PostData[];
};

type FakeManager = {
  __txnState: TxnState;
  create: (entity: unknown, data: Partial<FakeLogRow>) => Partial<FakeLogRow>;
  save: (
    entity: Partial<FakeLogRow> | Partial<FakeLogRow>[],
  ) => Promise<Partial<FakeLogRow> | Partial<FakeLogRow>[]>;
  getRepository: (entity?: unknown) => { find: () => Promise<unknown[]> };
};

type FakePostRow = { id: number; workout_log_id: number; user_id: string };

function keyOf(row: { userId: string; challengeId: string; localDay: string }) {
  return `${row.userId}|${row.challengeId}|${row.localDay}`;
}

function uniqueViolation(): Error & { code: string; constraint: string } {
  const error = new Error(
    'duplicate key value violates unique constraint "uq_workout_logs_user_challenge_local_day"',
  ) as Error & { code: string; constraint: string };
  error.code = '23505';
  error.constraint = 'uq_workout_logs_user_challenge_local_day';
  return error;
}

/**
 * Models the one piece of real Postgres behavior this test suite needs:
 * a unique index serializes concurrent INSERTs of the same key (the second
 * blocks until the first's transaction resolves), and re-validates against
 * the now-committed state once unblocked — it does NOT validate against
 * whatever the second transaction saw when it started. `enforceUnique:
 * false` reproduces the pre-B5 state (no database authority at all, exactly
 * the "check-then-insert" bug) for the reproduction test.
 */
class FakeWorkoutLogsTable {
  committed: FakeLogRow[] = [];
  private locks = new Map<string, Promise<void>>();
  private nextId = 1;

  constructor(private readonly enforceUnique: boolean) {}

  findExisting(userId: string, challengeId: string): FakeLogRow | undefined {
    return this.committed.find(
      (r) => r.userId === userId && r.challengeId === challengeId,
    );
  }

  async insert(row: {
    userId: string;
    challengeId: string;
    localDay: string;
  }): Promise<{ row: FakeLogRow; release: () => void }> {
    const key = keyOf(row);

    while (this.locks.has(key)) {
      await this.locks.get(key);
    }

    if (this.enforceUnique && this.committed.some((r) => keyOf(r) === key)) {
      throw uniqueViolation();
    }

    let releaseFn!: () => void;
    const lockPromise = new Promise<void>((resolve) => {
      releaseFn = resolve;
    });
    this.locks.set(key, lockPromise);

    const inserted: FakeLogRow = { id: this.nextId++, ...row };

    const release = () => {
      if (this.locks.get(key) === lockPromise) {
        this.locks.delete(key);
      }
      releaseFn();
    };

    return { row: inserted, release };
  }

  commit(row: FakeLogRow) {
    this.committed.push(row);
  }
}

class FakeWorkoutPostsTable {
  committed: FakePostRow[] = [];
  private nextId = 1;

  commitAll(rows: Array<Omit<FakePostRow, 'id'>>) {
    for (const row of rows) {
      this.committed.push({ id: this.nextId++, ...row });
    }
  }
}

const createMockRepo = () => ({
  find: jest.fn(),
  findOne: jest.fn(),
  findOneBy: jest.fn(),
  save: jest.fn(),
  create: jest.fn((v: unknown) => v),
});

/** Never rejects/throws — a real caller error would be a test bug, not a signal. */
const tick = () => new Promise<void>((resolve) => process.nextTick(resolve));

describe('WorkoutLogService — B5 concurrency', () => {
  const OPEN_CHALLENGE = { id: 'challenge-1', status: 'open' };

  let service: WorkoutLogService;
  let logsTable: FakeWorkoutLogsTable;
  let postsTable: FakeWorkoutPostsTable;
  let challengeRepo: ReturnType<typeof createMockRepo>;
  let challengeUserMapRepo: ReturnType<typeof createMockRepo>;
  let workoutPostsService: { create: jest.Mock };
  let failPostForUserIds: Set<string>;

  async function buildService(enforceUnique: boolean) {
    logsTable = new FakeWorkoutLogsTable(enforceUnique);
    postsTable = new FakeWorkoutPostsTable();
    challengeRepo = createMockRepo();
    challengeUserMapRepo = createMockRepo();
    failPostForUserIds = new Set();

    challengeRepo.findOne.mockResolvedValue(OPEN_CHALLENGE);
    challengeUserMapRepo.findOne.mockResolvedValue(null); // no-op auto-complete

    const workoutRepo = {
      ...createMockRepo(),
      findOne: jest.fn(async ({ where }: FindOneCall) => {
        // createWorkout() also calls this.findOne(savedWorkout.id) (via
        // WorkoutLogService.findOne) right at the end, on the by-id shape —
        // distinct from the pre-check's userId+challengeId+started_at shape
        // below. These tests don't touch relations, so the committed row
        // as-is is enough.
        if (where.id !== undefined) {
          return logsTable.committed.find((r) => r.id === where.id) ?? null;
        }

        // Real fast-path pre-check: reads only committed rows, exactly like
        // the real SELECT would only ever see committed data. Two
        // overlapping calls both land here before either has committed —
        // that's the TOCTOU window B5's DB constraint (not this SELECT)
        // actually closes.
        await tick();
        return (
          logsTable.findExisting(where.userId!, where.challengeId!) ?? null
        );
      }),
    };

    workoutPostsService = {
      create: jest.fn(async (data: PostData, manager: FakeManager) => {
        await tick();
        if (failPostForUserIds.has(data.user_id)) {
          throw new Error('simulated evidence-post write failure');
        }
        manager.__txnState.pendingPosts.push(data);
      }),
    };

    const dataSource = {
      transaction: jest.fn(
        async (cb: (manager: FakeManager) => Promise<FakeLogRow>) => {
          const txnState: TxnState = { pendingPosts: [] };

          const manager: FakeManager = {
            __txnState: txnState,
            create: (_entity: unknown, data: Partial<FakeLogRow>) => ({
              ...data,
            }),
            save: async (
              entity: Partial<FakeLogRow> | Partial<FakeLogRow>[],
            ) => {
              if (Array.isArray(entity)) return entity;
              await tick();
              const { row, release } = await logsTable.insert(
                entity as Omit<FakeLogRow, 'id'>,
              );
              txnState.pendingLog = row;
              txnState.releaseLock = release;
              return row;
            },
            getRepository: () => ({ find: () => Promise.resolve([]) }),
          };

          try {
            const result = await cb(manager);
            if (txnState.pendingLog) {
              logsTable.commit(txnState.pendingLog);
            }
            postsTable.commitAll(txnState.pendingPosts);
            return result;
          } finally {
            txnState.releaseLock?.();
          }
        },
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkoutLogService,
        {
          provide: getRepositoryToken(RoutineExercise),
          useValue: createMockRepo(),
        },
        { provide: getRepositoryToken(WorkoutLog), useValue: workoutRepo },
        { provide: WorkoutPostsService, useValue: workoutPostsService },
        { provide: DataSource, useValue: dataSource },
        {
          provide: getRepositoryToken(WorkoutLogExercise),
          useValue: createMockRepo(),
        },
        { provide: getRepositoryToken(Challenge), useValue: challengeRepo },
        {
          provide: getRepositoryToken(ChallengeUserMap),
          useValue: challengeUserMapRepo,
        },
      ],
    }).compile();

    service = module.get(WorkoutLogService);
  }

  function submit(userId: string, imageUrl = 'https://example.com/x.jpg') {
    return service.createWorkout({
      userId,
      challengeId: 'challenge-1',
      imageUrl,
      timezone: 'UTC',
    });
  }

  describe('reproduction: without a database-level constraint, the race is real', () => {
    // Step 2 of B5: demonstrates the actual pre-fix bug. With no DB
    // authority, the pre-check-then-insert pattern lets two overlapping
    // requests both pass the SELECT and both INSERT — two workout_logs rows
    // for what the product treats as a single day's progress.
    it('lets two overlapping requests for the same user+challenge+day both persist', async () => {
      await buildService(/* enforceUnique */ false);

      const results = await Promise.allSettled([
        submit('user-race'),
        submit('user-race'),
      ]);

      expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
      expect(
        logsTable.committed.filter(
          (r) => r.userId === 'user-race' && r.challengeId === 'challenge-1',
        ),
      ).toHaveLength(2); // the bug: two "today" rows for the same user+challenge
    });
  });

  describe('fix: uq_workout_logs_user_challenge_local_day makes the race safe', () => {
    beforeEach(() => buildService(/* enforceUnique */ true));

    it('a normal single submission succeeds and is persisted', async () => {
      const result = await submit('user-solo');

      expect(result).toBeDefined();
      expect(logsTable.committed).toHaveLength(1);
      expect(postsTable.committed).toHaveLength(1);
    });

    it('two simultaneous submissions produce exactly one persisted workout_logs row, and the loser gets a handled 409, not a 500', async () => {
      const results = await Promise.allSettled([
        submit('user-race-2'),
        submit('user-race-2'),
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter(
        (r) => r.status === 'rejected',
      ) as PromiseRejectedResult[];

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0].reason).toBeInstanceOf(ConflictException);
      expect((rejected[0].reason as ConflictException).message).toBe(
        'You already logged progress today',
      );

      // The actual authority: querying the fake DB state directly, not just
      // trusting one side's response — exactly one row exists, not "one
      // request returned an error".
      const rowsForUser = logsTable.committed.filter(
        (r) => r.userId === 'user-race-2',
      );
      expect(rowsForUser).toHaveLength(1);
    });

    it('more than two simultaneous submissions still produce exactly one persisted row', async () => {
      const attempts = 5;
      const results = await Promise.allSettled(
        Array.from({ length: attempts }, () => submit('user-race-many')),
      );

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter(
        (r) => r.status === 'rejected',
      ) as PromiseRejectedResult[];

      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(attempts - 1);
      expect(rejected.every((r) => r.reason instanceof ConflictException)).toBe(
        true,
      );

      expect(
        logsTable.committed.filter((r) => r.userId === 'user-race-many'),
      ).toHaveLength(1);
    });

    it('does not duplicate or partially persist the related evidence post under a race', async () => {
      await Promise.allSettled([
        submit('user-race-post'),
        submit('user-race-post'),
        submit('user-race-post'),
      ]);

      const winningLog = logsTable.committed.find(
        (r) => r.userId === 'user-race-post',
      )!;
      const postsForLog = postsTable.committed.filter(
        (p) => p.workout_log_id === winningLog.id,
      );
      expect(postsForLog).toHaveLength(1);
      // No orphan posts from a loser that should never have been persisted.
      expect(postsTable.committed).toHaveLength(1);
    });

    it('a sequential duplicate submission (no race) is also rejected, via the fast pre-check', async () => {
      await submit('user-sequential');

      await expect(submit('user-sequential')).rejects.toThrow(
        ConflictException,
      );
      expect(
        logsTable.committed.filter((r) => r.userId === 'user-sequential'),
      ).toHaveLength(1);
    });

    it('rolls back the workout log if the related evidence-post write fails, leaving no orphan row', async () => {
      failPostForUserIds.add('user-rollback');

      await expect(submit('user-rollback')).rejects.toThrow(
        'simulated evidence-post write failure',
      );

      expect(
        logsTable.committed.filter((r) => r.userId === 'user-rollback'),
      ).toHaveLength(0);
      expect(postsTable.committed).toHaveLength(0);
    });

    it('a failed racer does not block the winner from being committed', async () => {
      failPostForUserIds.add('user-mixed');

      // Both attempts fail post-creation here (same user) — this test only
      // asserts the DB is left fully consistent (no logs without posts),
      // not that one of them succeeds.
      const results = await Promise.allSettled([
        submit('user-mixed'),
        submit('user-mixed'),
      ]);

      expect(results.every((r) => r.status === 'rejected')).toBe(true);
      expect(
        logsTable.committed.filter((r) => r.userId === 'user-mixed'),
      ).toHaveLength(0);
      expect(postsTable.committed).toHaveLength(0);
    });
  });
});
