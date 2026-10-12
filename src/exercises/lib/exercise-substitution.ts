/**
 * Compatibility criterion for substituting one exercise for another when the
 * user trains at a different location (Sprint 9, B7).
 *
 * Candidate S is a valid substitute for original O at location L when ALL hold:
 *  1. S is active, S != O, and S is not already in the same routine.
 *  2. L-availability: S is mapped to L in exercise_location_map (or tagged
 *     'anywhere', the "can be done anywhere" tag).
 *  3. Required/primary coverage: every metric of O flagged isRequired OR
 *     isPrimary exists on S (same metric_type_id), so O's targets and logged
 *     values still have a place to live.
 *  4. No new obligations: every metric S flags isRequired exists on O, so the
 *     user is never forced to log something the routine never planned.
 *  5. Units: for every shared metric, if both defaultUnit values are set they
 *     must match (case-insensitive) -- a 20 "lbs" target must not become 20 "kg".
 * Non-required, non-primary metrics O has that S lacks are not blocking; their
 * targets are dropped for the substitute (see filterTargetsForSubstitute).
 */
export const ANYWHERE_LOCATION_CODE = 'anywhere';

export interface MetricDef {
  metricTypeId: number;
  isRequired: boolean;
  isPrimary: boolean;
  defaultUnit?: string | null;
}

export interface IncompatibilityReason {
  code: 'missing_metric' | 'extra_required_metric' | 'unit_mismatch';
  metricTypeId: number;
}

export interface CompatibilityResult {
  compatible: boolean;
  reasons: IncompatibilityReason[];
}

const sameUnit = (a?: string | null, b?: string | null) =>
  !a || !b || a.trim().toLowerCase() === b.trim().toLowerCase();

/** Rules 3-5 (metric preservation). Location/active checks live in the service. */
export function checkMetricCompatibility(
  original: MetricDef[],
  candidate: MetricDef[],
): CompatibilityResult {
  const reasons: IncompatibilityReason[] = [];
  const candidateById = new Map(candidate.map((m) => [m.metricTypeId, m]));
  const originalById = new Map(original.map((m) => [m.metricTypeId, m]));

  for (const o of original) {
    const c = candidateById.get(o.metricTypeId);
    if (!c) {
      if (o.isRequired || o.isPrimary) {
        reasons.push({ code: 'missing_metric', metricTypeId: o.metricTypeId });
      }
    } else if (!sameUnit(o.defaultUnit, c.defaultUnit)) {
      reasons.push({ code: 'unit_mismatch', metricTypeId: o.metricTypeId });
    }
  }
  for (const c of candidate) {
    if (c.isRequired && !originalById.has(c.metricTypeId)) {
      reasons.push({
        code: 'extra_required_metric',
        metricTypeId: c.metricTypeId,
      });
    }
  }
  return { compatible: reasons.length === 0, reasons };
}

/** Is the exercise doable at `locationCode`, given the codes it is mapped to? */
export function isAvailableAtLocation(
  exerciseLocationCodes: string[],
  locationCode: string,
): boolean {
  return (
    locationCode === ANYWHERE_LOCATION_CODE ||
    exerciseLocationCodes.includes(locationCode) ||
    exerciseLocationCodes.includes(ANYWHERE_LOCATION_CODE)
  );
}

/** Keeps only targets whose metric the substitute actually tracks. */
export function filterTargetsForSubstitute<T extends { metricTypeId: number }>(
  targets: T[],
  candidate: MetricDef[],
): T[] {
  const allowed = new Set(candidate.map((m) => m.metricTypeId));
  return targets.filter((t) => allowed.has(t.metricTypeId));
}
