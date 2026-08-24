import { Repository } from 'typeorm';
import { WorkoutLog, WorkoutStatus } from './entities/workout-log.entity';

/**
 * A "streak" shown anywhere in the app is 1 point per this many consecutive
 * days of completed activity — e.g. 3 days in a row = streak 1, 6 = streak
 * 2 — not the raw day count. See UsersService.attachProgress, which this
 * mirrors, for the original comment.
 */
export const STREAK_DAYS_PER_POINT = 3;

export function toStreakPoints(consecutiveDays: number): number {
  return Math.floor(consecutiveDays / STREAK_DAYS_PER_POINT);
}

/**
 * Consecutive calendar days (UTC, 'YYYY-MM-DD' keys) ending today, tolerating
 * today itself not having a completed day yet so an in-progress streak
 * doesn't drop to zero before the day is over. Pure — operates on an
 * already-fetched Set of day keys, so it works the same whether that set
 * came from a single-user or a per-user slice of a batched query.
 */
export function currentStreakDaysFromCompletedDays(
  completedDays: Set<string>,
): number {
  const cursor = new Date();
  cursor.setUTCHours(0, 0, 0, 0);
  const toKey = (d: Date) => d.toISOString().slice(0, 10);

  if (!completedDays.has(toKey(cursor))) {
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }

  let count = 0;
  while (completedDays.has(toKey(cursor))) {
    count++;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }

  return count;
}

async function fetchCompletedDays(
  workoutRepo: Repository<WorkoutLog>,
  userId: string,
): Promise<Set<string>> {
  const rows: Array<{ day: string }> = await workoutRepo
    .createQueryBuilder('w')
    .select('DISTINCT DATE(w.started_at)', 'day')
    .where('w.userId = :userId', { userId })
    .andWhere('w.status = :status', { status: WorkoutStatus.COMPLETED })
    .getRawMany();

  return new Set(rows.map((r) => String(r.day)));
}

/**
 * Consecutive calendar days (UTC) with at least one completed workout,
 * ending today, across ALL of a user's workouts regardless of challenge.
 * Single source of truth for this metric — previously duplicated between
 * BadgesService's streak badge and this module's friends'-streaks endpoint
 * (FollowsService.getFriendStreaks).
 */
export async function getCurrentStreakDays(
  workoutRepo: Repository<WorkoutLog>,
  userId: string,
): Promise<number> {
  const completedDays = await fetchCompletedDays(workoutRepo, userId);
  return currentStreakDaysFromCompletedDays(completedDays);
}

/**
 * Batched variant of getCurrentStreakDays for many users at once (e.g. the
 * friends' streaks list) — one grouped query instead of one per user, same
 * batching pattern as FollowsService.getFollowerCountsForUsers. A userId
 * with no completed days at all (or not present in `userIds`) is simply
 * absent from the returned map — callers should treat a missing key as 0.
 */
export async function getCurrentStreakDaysForUsers(
  workoutRepo: Repository<WorkoutLog>,
  userIds: string[],
): Promise<Map<string, number>> {
  if (userIds.length === 0) return new Map();

  const rows: Array<{ userId: string; day: string }> = await workoutRepo
    .createQueryBuilder('w')
    .select('w.userId', 'userId')
    .addSelect('DATE(w.started_at)', 'day')
    .where('w.userId IN (:...userIds)', { userIds })
    .andWhere('w.status = :status', { status: WorkoutStatus.COMPLETED })
    .groupBy('w.userId')
    .addGroupBy('DATE(w.started_at)')
    .getRawMany();

  const completedDaysByUser = new Map<string, Set<string>>();
  for (const row of rows) {
    const set = completedDaysByUser.get(row.userId) ?? new Set<string>();
    set.add(String(row.day));
    completedDaysByUser.set(row.userId, set);
  }

  const result = new Map<string, number>();
  for (const [userId, completedDays] of completedDaysByUser) {
    result.set(userId, currentStreakDaysFromCompletedDays(completedDays));
  }

  return result;
}

/**
 * Which of `userIds` have at least one workout_log row (any status — same
 * "logged something today" meaning as UsersService.attachProgress's
 * todayWorkouts/today_completed, just scoped per-user across all challenges
 * instead of per-challenge) with started_at falling today (UTC boundaries).
 * Batched — one query for every user instead of one per user.
 */
export async function getLoggedTodayUserIds(
  workoutRepo: Repository<WorkoutLog>,
  userIds: string[],
): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();

  const now = new Date();
  const start = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      0,
      0,
      0,
      0,
    ),
  );
  const end = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      23,
      59,
      59,
      999,
    ),
  );

  const rows: Array<{ userId: string }> = await workoutRepo
    .createQueryBuilder('w')
    .select('DISTINCT w.userId', 'userId')
    .where('w.userId IN (:...userIds)', { userIds })
    .andWhere('w.started_at BETWEEN :start AND :end', { start, end })
    .getRawMany();

  return new Set(rows.map((r) => r.userId));
}
