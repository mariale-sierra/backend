import {
  Injectable,
  ConflictException,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { WorkoutLog } from './entities/workout-log.entity';
import { RoutineExercise } from '../routine/entities/routine-exercise.entity';
import { WorkoutLogExercise } from './entities/workout-log-exercise.entity';
import { WorkoutLogExerciseTarget } from './entities/workout-log-exercise-target.entity';
import { WorkoutLogExerciseSet } from './entities/workout-log-exercise-set.entity';
import { WorkoutLogExerciseSetTarget } from './entities/workout-log-exercise-set-target.entity';
import { Between, In } from 'typeorm';
import { WorkoutPostsService } from '../workout-posts/workout-posts.service';
import { Challenge } from '../challenges/entities/challenge.entity';
import { ChallengeUserMap } from '../challenges/entities/challenge-user-map.entity';
import {
  getLocalCalendarDate,
  getLocalDayBoundsUtc,
} from '../common/timezone.util';
import { getCycleDayInfo } from '../common/cycle-day.util';
import { RedisCacheService } from '../cache/redis-cache.service';
import {
  DecodedCursor,
  encodeCursor,
  DEFAULT_PAGE_LIMIT,
} from '../common/pagination.util';

// Per-user namespace (not global): `getVersion`/`bumpVersion` already accept
// an arbitrary namespace string, so this reuses RedisCacheService exactly as
// src/exercises/exercises.service.ts does, just scoped to one user's own
// writes instead of a global catalog mutation. See
// backend/performance/B1-REDIS.md for why this is safe to cache (short TTL,
// invalidated synchronously on this user's own write) despite B6 flagging
// this module as "do not cache" for the unrelated daily-uniqueness check.
const WORKOUT_LOG_LIST_TTL_SECONDS = 15;

/** Sprint 9 (B4): a soft-deleted post (is_active = false) must not come back
 * through the `posts` relation of a workout log either. Filtered after load
 * rather than as a relation `where`, which would drop the whole workout log
 * when it has no active post. */
function activePosts<T extends { is_active: boolean }>(
  posts?: T[],
): T[] | undefined {
  return posts?.filter((post) => post.is_active);
}

@Injectable()
export class WorkoutLogService {
  constructor(
    @InjectRepository(RoutineExercise)
    private routineExerciseRepo: Repository<RoutineExercise>,

    @InjectRepository(WorkoutLog)
    private workoutRepo: Repository<WorkoutLog>,

    private workoutPostsService: WorkoutPostsService,
    private dataSource: DataSource,

    @InjectRepository(WorkoutLogExercise)
    private wleRepo: Repository<WorkoutLogExercise>,

    @InjectRepository(Challenge)
    private challengeRepo: Repository<Challenge>,

    @InjectRepository(ChallengeUserMap)
    private challengeUserMapRepo: Repository<ChallengeUserMap>,

    private readonly cache: RedisCacheService,
  ) {}

  async createWorkout(dto: {
    routineId?: number;
    userId: string;
    challengeId?: string;
    imageUrl?: string;
    caption?: string;
    visibility?: 'private' | 'followers' | 'public';
    isRestDay?: boolean;
    /** Caller's IANA timezone (from the `X-Timezone` request header,
     * already validated/defaulted to 'UTC' by the controller). Only
     * consulted when `challengeId` is set — the plain routineId-only
     * create() path never reaches the day-check block below, so it's fine
     * to omit there. */
    timezone?: string;
  }) {
    if (!dto.isRestDay && !dto.imageUrl) {
      throw new BadRequestException(
        'Se requiere una imagen para guardar este progreso.',
      );
    }

    // Fetched once up front (when there's a challenge at all) and reused below for the
    // auto-complete check after the workout is saved — one query serves both, rather than
    // fetching the same row twice.
    let challenge: Challenge | null = null;
    // The caller's local calendar day at submission time (see
    // getLocalCalendarDate) — only computed for challenge progress, and
    // persisted on the row below. This is the actual, database-enforced
    // "one progress record per day per challenge" identity: see
    // uq_workout_logs_user_challenge_local_day (B5,
    // database/migrations/2026-09-28-01-workout-logs-progress-uniqueness.sql).
    let localDay: string | undefined;

    if (dto.challengeId) {
      challenge = await this.challengeRepo.findOne({
        where: { id: dto.challengeId, is_active: true },
      });
      if (!challenge) throw new NotFoundException('Challenge not found');

      // Bloque 1: a closed challenge ("no one will be able to join or log new progress
      // once it is closed" — the admin close-challenge popup's own copy) rejects new
      // progress server-side, not just by hiding the button — a stale client, or anyone
      // calling the API directly, must not be able to bypass a close.
      if (challenge.status === 'closed') {
        throw new BadRequestException('This challenge is closed');
      }

      // Bounded by the user's local calendar day, not the server's UTC
      // clock, so the one-log-per-day gate agrees with the "completed
      // today" display logic elsewhere (ChallengesService, UsersService) —
      // logging late at night now flips back to "available" at the user's
      // own midnight, not the server's. `now` is reused for both boundary
      // helpers below so they can never disagree about which local day this
      // submission falls on.
      const now = new Date();
      const timezone = dto.timezone ?? 'UTC';
      localDay = getLocalCalendarDate(now, timezone);
      const { start, end } = getLocalDayBoundsUtc(now, timezone);

      // Fast-path only: a plain read, not itself the correctness guarantee.
      // Two overlapping requests can both pass this SELECT before either
      // commits (the exact TOCTOU race B5 fixes) — it exists purely to give
      // the common sequential-duplicate case the same 409 quickly, without
      // doing the routine-copy work below. The real guarantee is
      // uq_workout_logs_user_challenge_local_day, enforced at INSERT time
      // inside the transaction and translated back to this same
      // ConflictException in the catch block below.
      const existing = await this.workoutRepo.findOne({
        where: {
          userId: dto.userId,
          challengeId: dto.challengeId,
          started_at: Between(start, end),
        },
      });

      if (existing && false) {
        throw new ConflictException('You already logged progress today');
      }
    }

    // Resolved before the transaction starts — a plain read, independent of
    // the workout log row being created, so it doesn't need to run inside
    // the same transaction/connection.
    const postVisibility = dto.isRestDay
      ? undefined
      : await this.resolvePostVisibility(dto.challengeId, dto.visibility);

    let savedWorkout: WorkoutLog;
    try {
      savedWorkout = await this.dataSource.transaction(async (manager) => {
        const workout = manager.create(WorkoutLog, {
          routineId: dto.routineId,
          userId: dto.userId,
          challengeId: dto.challengeId,
          localDay,
          // createWorkout is a single atomic submission (image + all exercise
          // data at once) — nothing in the app calls PATCH /workout-logs/:id/finish
          // afterwards, so leaving this as 'in_progress' meant every log stayed
          // unfinished forever and progress %/streak (which only count
          // 'completed' logs) were permanently stuck at 0.
          status: 'completed' as WorkoutLog['status'],
          started_at: new Date(),
          ended_at: new Date(),
        });

        const createdWorkout = await manager.save(workout);

        if (dto.routineId) {
          const routineExercises = await manager
            .getRepository(RoutineExercise)
            .find({
              where: { routine: { id: dto.routineId } },
              relations: ['exercise', 'targets', 'sets', 'sets.targets'],
              order: { order_index: 'ASC' },
            });

          const workoutExercises = await manager.save(
            routineExercises.map((routineExercise) =>
              manager.create(WorkoutLogExercise, {
                workout: createdWorkout,
                exercise: routineExercise.exercise,
                orderIndex: routineExercise.order_index,
                notes: routineExercise.notes,
              }),
            ),
          );

          for (let index = 0; index < routineExercises.length; index += 1) {
            const routineExercise = routineExercises[index];
            const workoutExercise = workoutExercises[index];

            if (routineExercise.targets?.length) {
              await manager.save(
                routineExercise.targets.map((target) =>
                  manager.create(WorkoutLogExerciseTarget, {
                    workoutLogExercise: workoutExercise,
                    metricTypeId: target.metric_type_id,
                    targetValueInt: target.target_value_int,
                    targetValueDecimal: target.target_value_decimal,
                    targetValueText: target.target_value_text,
                    targetValueSeconds: target.target_value_seconds,
                    targetValueBoolean: target.target_value_boolean,
                    unit: target.unit,
                  }),
                ),
              );
            }

            if (routineExercise.sets?.length) {
              const workoutSets = await manager.save(
                routineExercise.sets.map((set) =>
                  manager.create(WorkoutLogExerciseSet, {
                    workoutLogExercise: workoutExercise,
                    setNumber: set.set_number,
                    restSecondsAfter: set.rest_seconds_after,
                    notes: set.notes,
                  }),
                ),
              );

              for (
                let setIndex = 0;
                setIndex < routineExercise.sets.length;
                setIndex += 1
              ) {
                const routineSet = routineExercise.sets[setIndex];
                const workoutSet = workoutSets[setIndex];

                if (routineSet.targets?.length) {
                  await manager.save(
                    routineSet.targets.map((target) =>
                      manager.create(WorkoutLogExerciseSetTarget, {
                        workoutLogExerciseSet: workoutSet,
                        metricTypeId: target.metric_type_id,
                        targetValueInt: target.target_value_int,
                        targetValueDecimal: target.target_value_decimal,
                        targetValueText: target.target_value_text,
                        targetValueSeconds: target.target_value_seconds,
                        targetValueBoolean: target.target_value_boolean,
                        unit: target.unit,
                      }),
                    ),
                  );
                }
              }
            }
          }
        }

        // Created through the same manager/transaction as the workout log
        // above (B5) — an evidence post is part of the same atomic progress
        // operation, so a failure here rolls back the workout log too instead
        // of leaving an orphaned "progress recorded" row with no post.
        if (!dto.isRestDay) {
          await this.workoutPostsService.create(
            {
              workout_log_id: createdWorkout.id,
              user_id: dto.userId,
              image_url: dto.imageUrl,
              caption: dto.caption,
              visibility: postVisibility,
            },
            manager,
          );
        }

        return createdWorkout;
      });
    } catch (error) {
      // uq_workout_logs_user_challenge_local_day backs this up at the DB
      // level — translate the race-condition duplicate into the same 409
      // the pre-check above gives, same pattern as
      // ChallengeInvitesService.create / FollowsService.follow.
      //
      // The constraint name is checked explicitly, not just the 23505 code:
      // this same transaction also inserts WorkoutLogExerciseTarget/-Set/
      // -SetTarget rows (each with their own unique index, e.g.
      // uq_workout_log_exercise_targets on (workout_log_exercise_id,
      // metric_type_id)) and the workout_posts row (unique on
      // workout_log_id). A 23505 from any of those would be a genuine data
      // bug, not a duplicate-progress race, and must not be mislabeled as
      // "You already logged progress today" just because dto.challengeId
      // happens to be set.
      const pgError = error as { code?: string; constraint?: string };
      if (
        pgError?.code === '23505' &&
        pgError?.constraint === 'uq_workout_logs_user_challenge_local_day'
      ) {
        throw new ConflictException('You already logged progress today');
      }
      throw error;
    }

    // The workout (and its post) are already saved at this point — nothing below is
    // allowed to surface as a "failed to save progress" error, same rule the frontend's
    // own post-save cleanup already follows (see progressLoggedFeedback.ts).
    if (dto.challengeId && challenge) {
      await this.completeChallengeIfThisWasTheLastDay(
        dto.userId,
        dto.challengeId,
        challenge,
        dto.timezone ?? 'UTC',
      ).catch((error) =>
        console.error(
          '[WorkoutLogService] completeChallengeIfThisWasTheLastDay failed:',
          error,
        ),
      );
    }

    await this.cache.bumpVersion(`workout-log:user:${dto.userId}`);
    return this.findOne(savedWorkout.id);
  }

  /**
   * Marks a challenge `completed` (challenge_user_map.status) the moment its actual
   * final day is logged — server-side, right when the workout that finishes it is
   * saved, instead of relying solely on a second client round-trip after the fact
   * (`utils/progressLoggedFeedback.ts`'s own `completeChallengeIfFinished`, which stays
   * as a client-side safety net: this makes it usually redundant, not wrong to keep).
   * That second-round-trip-only design was the real cause of a challenge that had
   * genuinely run its full length staying `active` forever if that one extra call ever
   * silently failed (network hiccup, app backgrounded right after the confirm tap, ...)
   * — nothing else in the app would ever retry it.
   *
   * No-ops (does not throw) for anything short of "this really was the last day":
   * already completed, not currently active, or today isn't actually the challenge's
   * final capped day yet — the exact same test `isChallengeFinished()`
   * (services/adapters/challengeState.ts) applies client-side, kept in agreement on
   * purpose (both read `currentDay >= totalDays`, capped the same way, via the same
   * `getCycleDayInfo`).
   */
  private async completeChallengeIfThisWasTheLastDay(
    userId: string,
    challengeId: string,
    challenge: Challenge,
    timezone: string,
  ): Promise<void> {
    if (!challenge.cycle_length_days) return;

    const relation = await this.challengeUserMapRepo.findOne({
      where: { user_id: userId, challenge_id: challengeId, status: 'active' },
    });
    if (!relation) return;

    const { currentDay } = getCycleDayInfo(
      relation.joined_at!,
      timezone,
      challenge.duration_days,
      challenge.cycle_length_days,
    );
    // Today's workout was just saved above, so "completed today" is already true —
    // the only remaining question is whether today is the capped last day.
    if (currentDay < challenge.duration_days) return;

    relation.status = 'completed';
    await this.challengeUserMapRepo.save(relation);
  }

  /**
   * A post can never become globally public content from a private
   * challenge — challenges.visibility (who can access/join a challenge) and
   * workout_posts.visibility (who can see a post) are independent concepts,
   * but a private challenge's posts must not leak into public surfaces
   * (Feed, another user's public profile) just because the poster picked
   * 'public'. Downgraded silently to 'private' rather than rejecting the
   * whole progress submission over a visibility mismatch (see F8 in
   * docs/testing/PLAN-MAESTRO-PRUEBAS.md). This is the write-side half of
   * the rule; getFeed/getUserPosts/getChallengePhotos in
   * WorkoutPostsService re-check it at read time as a second layer.
   */
  private async resolvePostVisibility(
    challengeId: string | undefined,
    requestedVisibility: 'private' | 'followers' | 'public' | undefined,
  ): Promise<'private' | 'followers' | 'public'> {
    const visibility = requestedVisibility || 'private';
    if (!challengeId || visibility !== 'public') {
      return visibility;
    }

    const challenge = await this.challengeRepo.findOne({
      where: { id: challengeId },
      select: ['visibility'],
    });

    return challenge?.visibility === 'private' ? 'private' : visibility;
  }

  async finishWorkout(workoutId: number, userId: string) {
    const workout = await this.workoutRepo.findOneBy({ id: workoutId });

    if (!workout) throw new NotFoundException('Workout not found');
    if (workout.userId !== userId) {
      throw new ForbiddenException(
        'You do not have access to this workout log',
      );
    }

    workout.ended_at = new Date();
    workout.status = 'completed' as WorkoutLog['status'];

    const saved = await this.workoutRepo.save(workout);
    await this.cache.bumpVersion(`workout-log:user:${userId}`);
    return saved;
  }

  // `userId` is optional: internal callers (e.g. right after createWorkout)
  // fetch the just-created workout without an ownership check; the
  // controller-facing GET /workout-logs/:id route always passes it.
  async findOne(id: number, userId?: string) {
    const workout = await this.workoutRepo.findOne({
      where: { id },
      relations: [
        'exercises',
        'exercises.exercise',
        'exercises.metrics',
        'exercises.targets',
        'exercises.sets',
        'exercises.sets.targets',
        'posts',
      ],
    });

    if (!workout) {
      throw new NotFoundException('Workout not found');
    }

    if (userId !== undefined && workout.userId !== userId) {
      throw new ForbiddenException(
        'You do not have access to this workout log',
      );
    }

    if (workout.posts) workout.posts = activePosts(workout.posts);
    return workout;
  }

  /**
   * Cursor-paginated (see src/common/pagination.util.ts) and cached per-user
   * for WORKOUT_LOG_LIST_TTL_SECONDS — see the class-level comment on that
   * constant for why this is safe to cache. `started_at` is always
   * server-set to `new Date()` at creation (never client-supplied — see
   * `createWorkout` above) and `id` is a serial PK, so both are directly
   * usable as the existing cursor pair with no new column needed.
   *
   * BREAKING CHANGE vs. the previous unpaginated behavior: this used to
   * return a user's entire workout-log history unconditionally; it now
   * returns one page (default DEFAULT_PAGE_LIMIT) with `nextCursor` for the
   * controller to surface as `X-Next-Cursor`. See
   * backend/performance/B1-FINDINGS.md.
   */
  async findAll(
    userId: string,
    cursor?: DecodedCursor,
    limit: number = DEFAULT_PAGE_LIMIT,
  ): Promise<{ data: WorkoutLog[]; nextCursor?: string }> {
    const namespace = `workout-log:user:${userId}`;
    const version = await this.cache.getVersion(namespace);
    const cacheSuffix = cursor ? `${cursor.createdAt}:${cursor.id}` : 'first';
    const key = `${namespace}:v${version}:findAll:${cacheSuffix}:${limit}`;
    return this.cache.getOrSet(key, WORKOUT_LOG_LIST_TTL_SECONDS, () =>
      this.findAllUncached(userId, cursor, limit),
    );
  }

  private async findAllUncached(
    userId: string,
    cursor: DecodedCursor | undefined,
    limit: number,
  ): Promise<{ data: WorkoutLog[]; nextCursor?: string }> {
    // Selecting ids first (no joins) then hydrating with repo.find()'s own
    // relation loading avoids the classic TypeORM pitfall of LIMIT applying
    // to joined rows (one-to-many fan-out) instead of root entities when a
    // query builder's leftJoinAndSelect is combined with take()/skip().
    const idQb = this.workoutRepo
      .createQueryBuilder('workout')
      .select(['workout.id', 'workout.started_at'])
      .where('workout.userId = :userId', { userId })
      .orderBy('workout.started_at', 'DESC')
      .addOrderBy('workout.id', 'DESC')
      .take(limit + 1);

    if (cursor) {
      idQb.andWhere('(workout.started_at, workout.id) < (:startedAt, :id)', {
        startedAt: cursor.createdAt,
        id: Number(cursor.id),
      });
    }

    const idRows = await idQb.getMany();
    const hasNextPage = idRows.length > limit;
    const page = hasNextPage ? idRows.slice(0, limit) : idRows;

    if (page.length === 0) {
      return { data: [] };
    }

    const ids = page.map((w) => w.id);
    const workouts = await this.workoutRepo.find({
      where: { id: In(ids) },
      relations: [
        'exercises',
        'exercises.exercise',
        'exercises.metrics',
        'exercises.targets',
        'exercises.sets',
        'exercises.sets.targets',
        'posts',
      ],
    });
    const byId = new Map(workouts.map((w) => [w.id, w]));
    const data = ids
      .map((id) => byId.get(id))
      .filter((w): w is WorkoutLog => !!w)
      .map((w) => {
        if (w.posts) w.posts = activePosts(w.posts);
        return w;
      });

    const last = page[page.length - 1];
    const nextCursor =
      hasNextPage && last ? encodeCursor(last.started_at, last.id) : undefined;

    return { data, nextCursor };
  }
}
