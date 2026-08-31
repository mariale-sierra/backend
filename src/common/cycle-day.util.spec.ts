import { getCycleDayInfo } from './cycle-day.util';

describe('cycle-day.util', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  describe('getCycleDayInfo', () => {
    it('returns day 1 on the day the user joined', () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-08-27T12:00:00.000Z'));

      const result = getCycleDayInfo(
        new Date('2026-08-27T09:00:00.000Z'),
        'UTC',
        30,
        7,
      );

      expect(result.currentDay).toBe(1);
      expect(result.currentDayInCycle).toBe(1);
      expect(result.isCompleted).toBe(false);
    });

    it('maps an absolute day onto the right 1-indexed cycle position', () => {
      jest.useFakeTimers();
      // Joined day 1 -> 10 full days later is day 11 -> cycle length 4 ->
      // ((11-1) % 4) + 1 = 3.
      jest.setSystemTime(new Date('2026-09-06T12:00:00.000Z'));

      const result = getCycleDayInfo(
        new Date('2026-08-27T12:00:00.000Z'),
        'UTC',
        30,
        4,
      );

      expect(result.currentDay).toBe(11);
      expect(result.currentDayInCycle).toBe(3);
    });

    it('returns null currentDayInCycle when cycleLengthDays is not configured, without throwing', () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-08-27T12:00:00.000Z'));

      const result = getCycleDayInfo(
        new Date('2026-08-27T09:00:00.000Z'),
        'UTC',
        30,
        null,
      );

      expect(result.currentDayInCycle).toBeNull();
    });

    // The exact bug this util was extracted to fix: a "mind body challenge"
    // shape (duration_days=28, cycle_length_days=4) still running on day 35 —
    // ChallengesService used to feed the UNCAPPED elapsed-days count into the
    // cycle-position formula, while UsersService capped it first. Same inputs
    // through this one function must now always agree.
    it('caps currentDay at durationDays before computing the cycle position, once the challenge has run longer than its duration', () => {
      jest.useFakeTimers();
      // Joined 34 days before "now" -> raw elapsed day 35, 7 days past the
      // 28-day duration.
      jest.setSystemTime(new Date('2026-09-30T12:00:00.000Z'));

      const result = getCycleDayInfo(
        new Date('2026-08-27T12:00:00.000Z'),
        'UTC',
        28,
        4,
      );

      // currentDay capped at 28, not the raw 35.
      expect(result.currentDay).toBe(28);
      // Cycle position computed from the CAPPED day: ((28-1) % 4) + 1 = 4 —
      // NOT ((35-1) % 4) + 1 = 3, which is what the uncapped bug produced
      // for this same instant (a different cycle position entirely).
      expect(result.currentDayInCycle).toBe(4);
      expect(result.isCompleted).toBe(true);
    });

    it('never returns a currentDay past durationDays, however far past it the elapsed days go', () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2027-01-01T12:00:00.000Z'));

      const result = getCycleDayInfo(
        new Date('2026-08-27T12:00:00.000Z'),
        'UTC',
        28,
        4,
      );

      expect(result.currentDay).toBe(28);
      expect(result.isCompleted).toBe(true);
    });

    it('does not cap currentDay when durationDays is 0/unconfigured', () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-09-30T12:00:00.000Z'));

      const result = getCycleDayInfo(
        new Date('2026-08-27T12:00:00.000Z'),
        'UTC',
        0,
        4,
      );

      expect(result.currentDay).toBe(35);
      expect(result.isCompleted).toBe(true);
    });

    it('is timezone-aware: a user behind UTC does not roll to the next day just because UTC crossed midnight', () => {
      jest.useFakeTimers();
      // 2026-08-28T04:00:00Z is already Aug 28 in UTC, but still Aug 27
      // 21:00 in America/Los_Angeles (UTC-7 in August).
      jest.setSystemTime(new Date('2026-08-28T04:00:00.000Z'));

      const utcResult = getCycleDayInfo(
        new Date('2026-08-27T12:00:00.000Z'),
        'UTC',
        30,
        7,
      );
      const laResult = getCycleDayInfo(
        new Date('2026-08-27T12:00:00.000Z'),
        'America/Los_Angeles',
        30,
        7,
      );

      expect(utcResult.currentDay).toBe(2);
      expect(laResult.currentDay).toBe(1);
    });
  });
});
