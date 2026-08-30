import {
  resolveTimezone,
  getLocalMidnightUtc,
  getLocalDayBoundsUtc,
} from './timezone.util';

describe('timezone.util', () => {
  describe('resolveTimezone', () => {
    it('returns the header value unchanged when it is a valid IANA timezone', () => {
      expect(resolveTimezone('America/New_York')).toBe('America/New_York');
    });

    it('falls back to UTC when the header is missing', () => {
      expect(resolveTimezone(undefined)).toBe('UTC');
    });

    it('falls back to UTC for an empty string', () => {
      expect(resolveTimezone('')).toBe('UTC');
    });

    it('falls back to UTC for a string Intl does not recognize as a timezone', () => {
      expect(resolveTimezone('Not/AZone')).toBe('UTC');
    });

    it('falls back to UTC for a non-string value (e.g. a duplicated header parsed as an array)', () => {
      expect(resolveTimezone(['America/New_York', 'Asia/Tokyo'])).toBe(
        'America/New_York',
      );
      expect(resolveTimezone(123)).toBe('UTC');
      expect(resolveTimezone(null)).toBe('UTC');
    });

    it('never throws, even for garbage input', () => {
      expect(() => resolveTimezone({ malicious: true })).not.toThrow();
    });
  });

  describe('getLocalMidnightUtc', () => {
    it('returns the same instant as UTC midnight when timezone is UTC', () => {
      const midnight = getLocalMidnightUtc(
        new Date('2026-08-27T15:30:00.000Z'),
        'UTC',
      );
      expect(midnight.toISOString()).toBe('2026-08-27T00:00:00.000Z');
    });

    it('accounts for a negative UTC offset (America/Los_Angeles, PDT = UTC-7 in August)', () => {
      // 2026-08-28T04:00:00Z is 2026-08-27T21:00:00 local in LA — local
      // midnight for that calendar day is 7 hours after UTC midnight.
      const midnight = getLocalMidnightUtc(
        new Date('2026-08-28T04:00:00.000Z'),
        'America/Los_Angeles',
      );
      expect(midnight.toISOString()).toBe('2026-08-27T07:00:00.000Z');
    });

    it('accounts for a positive UTC offset (Asia/Tokyo, UTC+9, no DST)', () => {
      // 2026-08-27T16:00:00Z is 2026-08-28T01:00:00 local in Tokyo — local
      // midnight for that calendar day is 9 hours before UTC midnight.
      const midnight = getLocalMidnightUtc(
        new Date('2026-08-27T16:00:00.000Z'),
        'Asia/Tokyo',
      );
      expect(midnight.toISOString()).toBe('2026-08-27T15:00:00.000Z');
    });

    it('never throws for an unrecognized timezone, degrading to UTC', () => {
      const date = new Date('2026-08-27T15:30:00.000Z');
      expect(getLocalMidnightUtc(date, 'Not/AZone')).toEqual(
        getLocalMidnightUtc(date, 'UTC'),
      );
    });
  });

  describe('getLocalDayBoundsUtc', () => {
    it('returns a [start, end] pair spanning exactly one local calendar day', () => {
      const { start, end } = getLocalDayBoundsUtc(
        new Date('2026-08-28T04:00:00.000Z'),
        'America/Los_Angeles',
      );
      expect(start.toISOString()).toBe('2026-08-27T07:00:00.000Z');
      expect(end.toISOString()).toBe('2026-08-28T06:59:59.999Z');
    });
  });
});
