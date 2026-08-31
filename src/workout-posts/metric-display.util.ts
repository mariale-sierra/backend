/**
 * Formats the real logged value for a workout-post photo card exercise row
 * ("12 reps", "20m 30s") instead of just a set count. Deliberately mirrors
 * the frontend's own simplification for planned targets — see
 * `app/challenge/[id]/routine/[day].tsx`'s `formatFieldValue()`/
 * `formatSeconds()` and `services/adapters/metricsAdapter.ts`'s
 * `extractTargetValue()` — same "pick one primary metric, format its value"
 * shape, so a number reads identically here and on Routine-Detail. The one
 * deliberate difference: unit suffixes come from `metric_types.default_unit`
 * (already available via SQL here) rather than the frontend's hardcoded
 * "lbs"/"km", since a real unit column exists to read instead of guessing.
 */

export interface MetricValueRow {
  metric_code: string | null;
  default_unit: string | null;
  target_value_int: number | string | null;
  target_value_decimal: number | string | null;
  target_value_seconds: number | string | null;
}

/** Reads the one target_value_* column that applies for this row's metric
 * code — reps is a plain int, weight/distance are decimals, time is stored
 * in whole seconds. Mirrors `metricsAdapter.ts`'s `extractTargetValue()`. */
export function extractMetricValue(row: MetricValueRow): number | null {
  switch (row.metric_code) {
    case 'reps':
      return row.target_value_int != null ? Number(row.target_value_int) : null;
    case 'weight':
    case 'distance':
      return row.target_value_decimal != null
        ? Number(row.target_value_decimal)
        : null;
    case 'time':
      return row.target_value_seconds != null
        ? Number(row.target_value_seconds)
        : null;
    default:
      return null;
  }
}

/**
 * reps beats weight, time beats distance — same pairing the frontend's
 * `ACTIVITY_METRIC_CONFIG` uses (strength's primary column is reps, cardio's
 * is duration), so when a set has both members of a pair logged, the more
 * informative one wins. Unlike a strict port of the frontend's
 * `activityTypeFromMetricCodes()` (which always assumes reps/time and
 * ignores a set logged with only weight or only distance), this falls
 * through to whichever code is actually present — real logged data is never
 * silently dropped just because its usual pair-mate wasn't also logged.
 */
const PRIMARY_METRIC_PRIORITY = ['reps', 'time', 'weight', 'distance'];

export function pickPrimaryMetricCode(codes: Set<string>): string | null {
  for (const code of PRIMARY_METRIC_PRIORITY) {
    if (codes.has(code)) return code;
  }
  const [first] = codes;
  return first ?? null;
}

/** "45" -> "45s", "90" -> "1m 30s". Mirrors `[day].tsx`'s `formatSeconds()`. */
function formatSecondsDisplay(totalSeconds: number): string {
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
}

/** Reps read bare ("12"); weight/distance get their real unit from
 * `metric_types.default_unit`; time renders via formatSecondsDisplay(). */
function formatMetricDisplayValue(
  code: string,
  value: number,
  defaultUnit: string | null,
): string {
  if (code === 'reps') return `${value}`;
  if (code === 'time') return formatSecondsDisplay(value);
  return defaultUnit ? `${value} ${defaultUnit}` : `${value}`;
}

/**
 * Formats the primary metric's value out of a set of candidate rows (either
 * the targets on one set, or an exercise's exercise-level actual metrics).
 * Returns null when none of the rows carry an actual value — the caller's
 * cue to fall back to a generic "Logged" label.
 */
export function formatPrimaryMetric(rows: MetricValueRow[]): string | null {
  const codes = new Set(
    rows.map((r) => r.metric_code).filter((c): c is string => Boolean(c)),
  );
  const primaryCode = pickPrimaryMetricCode(codes);
  if (!primaryCode) return null;

  const primaryRow = rows.find((r) => r.metric_code === primaryCode);
  if (!primaryRow) return null;

  const value = extractMetricValue(primaryRow);
  if (value === null) return null;

  return formatMetricDisplayValue(primaryCode, value, primaryRow.default_unit);
}
