import { getLocalMidnightUtc } from './timezone.util';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface CycleDayInfo {
  /** Days elapsed since joining, 1-indexed, capped at `durationDays` once
   * that's configured (a challenge with no duration returns the raw count
   * uncapped) — the one "which day of the challenge is this" value every
   * caller should show or feed into a cycle-position calculation. */
  currentDay: number;
  /** `currentDay` mapped onto a 1-indexed position within the challenge's
   * cycle, computed from the CAPPED `currentDay` above — this is the fix:
   * computing it from an uncapped day count is what let a challenge running
   * longer than its own duration land on a different cycle position
   * depending on which service asked. Null when `cycleLengthDays` isn't
   * configured — a genuinely unset cycle, not a validation error; a caller
   * that requires one configured should guard for that itself. */
  currentDayInCycle: number | null;
  /** True once the user has been enrolled longer than `durationDays`.
   * Computed from the RAW, pre-cap elapsed-days count — capping `currentDay`
   * for display must not also hide that the challenge is actually done. */
  isCompleted: boolean;
}

/**
 * The one "which day of the challenge, and which cycle position, is today"
 * calculation — previously duplicated between
 * `ChallengesService.calculateCurrentDay()`/`calculateCurrentDayInCycle()`
 * and an inline copy in `UsersService.attachProgress()`. Only the latter
 * capped the elapsed-days count at `durationDays` before mapping it onto a
 * cycle position; the former didn't, so a challenge running longer than its
 * own duration could disagree with itself on today's cycle position
 * depending on which endpoint answered — e.g. the Log Metrics picker
 * (capped) says a challenge is available today while the metrics-entry
 * screen (uncapped) says there's no routine today, for the same instant.
 *
 * `timezone` is the caller's already-validated IANA timezone (see
 * `timezone.util.ts`'s `resolveTimezone()`) — "today" is computed against
 * local midnight in that timezone, not the server's UTC clock.
 */
export function getCycleDayInfo(
  joinedAt: Date,
  timezone: string,
  durationDays: number,
  cycleLengthDays: number | null | undefined,
): CycleDayInfo {
  const joinedMidnightUtc = getLocalMidnightUtc(new Date(joinedAt), timezone);
  const todayMidnightUtc = getLocalMidnightUtc(new Date(), timezone);

  const daysSinceStart = Math.floor(
    (todayMidnightUtc.getTime() - joinedMidnightUtc.getTime()) / MS_PER_DAY,
  );
  const rawCurrentDay = Math.max(daysSinceStart + 1, 1);
  const currentDay = durationDays
    ? Math.min(rawCurrentDay, durationDays)
    : rawCurrentDay;

  return {
    currentDay,
    currentDayInCycle: cycleLengthDays
      ? ((currentDay - 1) % cycleLengthDays) + 1
      : null,
    isCompleted: rawCurrentDay > durationDays,
  };
}
