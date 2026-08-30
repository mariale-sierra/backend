/**
 * Timezone-aware "local day" helpers, shared by ChallengesService and
 * UsersService so "current day" / "completed today" agree with the day the
 * user actually sees on their device, not the server's UTC calendar day.
 *
 * The server process itself is pinned to UTC (see ../set-timezone.ts) so
 * Postgres timestamps parse correctly — none of that changes here. This file
 * only converts between a UTC instant and the wall-clock day it falls on in
 * an arbitrary IANA timezone, using native Intl (no new dependency).
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Validates and normalizes the `X-Timezone` request header. Falls back to
 * 'UTC' (the previous, timezone-unaware behavior) for a missing header,
 * an array header, or any string Intl doesn't recognize as a timezone —
 * never throws.
 */
export function resolveTimezone(headerValue: unknown): string {
  const value = Array.isArray(headerValue)
    ? (headerValue as unknown[])[0]
    : headerValue;
  if (typeof value !== 'string' || !value.trim()) {
    return 'UTC';
  }
  try {
    // Constructing the formatter is how Intl validates the IANA name; it
    // throws RangeError for anything it doesn't recognize.
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return value;
  } catch {
    return 'UTC';
  }
}

/**
 * Convenience wrapper for controllers: pulls the `X-Timezone` header off an
 * (untyped, `@Req()`-injected) request object and resolves it. Takes the
 * loosely-typed `headers` shape rather than express's `Request` so callers
 * don't need to retype their existing untyped `req` parameter just to read
 * one header.
 */
export function resolveRequestTimezone(req: {
  headers: Record<string, unknown>;
}): string {
  return resolveTimezone(req.headers['x-timezone']);
}

function getOffsetMinutes(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date);

  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);

  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour') % 24,
    get('minute'),
    get('second'),
  );

  return (asUtc - date.getTime()) / 60000;
}

function getLocalDateParts(
  date: Date,
  timeZone: string,
): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);

  return { year: get('year'), month: get('month'), day: get('day') };
}

/**
 * The UTC instant of local midnight (00:00:00.000) on the calendar day
 * `date` falls on when observed in `timeZone`. This is the boundary used for
 * "current day" / streak arithmetic — diffing two of these gives whole local
 * calendar days regardless of the server's own timezone.
 *
 * Re-validates `timeZone` itself (via `resolveTimezone`) rather than trusting
 * the caller, so this never throws even if called with an unvalidated string
 * directly (bypassing the controller's own header validation).
 */
export function getLocalMidnightUtc(date: Date, timeZone: string): Date {
  const safeTimeZone = resolveTimezone(timeZone);
  const { year, month, day } = getLocalDateParts(date, safeTimeZone);
  const guessUtc = Date.UTC(year, month - 1, day, 0, 0, 0, 0);
  const offsetMinutes = getOffsetMinutes(new Date(guessUtc), safeTimeZone);
  return new Date(guessUtc - offsetMinutes * 60000);
}

/**
 * [start, end] UTC instants bounding the local calendar day `date` falls on
 * in `timeZone` — used for "did the user log a workout today" range queries.
 */
export function getLocalDayBoundsUtc(
  date: Date,
  timeZone: string,
): { start: Date; end: Date } {
  const start = getLocalMidnightUtc(date, timeZone);
  return { start, end: new Date(start.getTime() + MS_PER_DAY - 1) };
}
