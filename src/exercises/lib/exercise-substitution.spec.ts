import {
  checkMetricCompatibility,
  filterTargetsForSubstitute,
  isAvailableAtLocation,
  type MetricDef,
} from './exercise-substitution';

const m = (id: number, o: Partial<MetricDef> = {}): MetricDef => ({
  metricTypeId: id,
  isRequired: false,
  isPrimary: false,
  defaultUnit: null,
  ...o,
});

const REPS = 1;
const WEIGHT = 2;
const TIME = 3;
const DISTANCE = 4;

describe('checkMetricCompatibility', () => {
  const strength = [
    m(REPS, { isRequired: true, isPrimary: true }),
    m(WEIGHT, { defaultUnit: 'lbs' }),
  ];

  it('accepts a substitute with the same required/primary metrics', () => {
    const r = checkMetricCompatibility(strength, [
      m(REPS, { isRequired: true, isPrimary: true }),
      m(WEIGHT, { defaultUnit: 'lbs' }),
    ]);
    expect(r).toEqual({ compatible: true, reasons: [] });
  });

  it('accepts a bodyweight substitute that drops an optional non-primary metric', () => {
    const r = checkMetricCompatibility(strength, [
      m(REPS, { isRequired: true, isPrimary: true }),
    ]);
    expect(r.compatible).toBe(true);
  });

  it('rejects a substitute missing a required or primary metric', () => {
    const r = checkMetricCompatibility(strength, [m(TIME, { isPrimary: true })]);
    expect(r.compatible).toBe(false);
    expect(r.reasons).toContainEqual({
      code: 'missing_metric',
      metricTypeId: REPS,
    });
  });

  it('rejects a substitute missing a primary metric even if not required', () => {
    const r = checkMetricCompatibility(
      [m(TIME, { isPrimary: true })],
      [m(REPS)],
    );
    expect(r.reasons).toContainEqual({
      code: 'missing_metric',
      metricTypeId: TIME,
    });
  });

  it('rejects a substitute that requires a metric the original never tracked', () => {
    const r = checkMetricCompatibility(strength, [
      m(REPS, { isRequired: true, isPrimary: true }),
      m(DISTANCE, { isRequired: true }),
    ]);
    expect(r.reasons).toContainEqual({
      code: 'extra_required_metric',
      metricTypeId: DISTANCE,
    });
  });

  it('allows extra optional metrics on the substitute', () => {
    const r = checkMetricCompatibility(strength, [
      m(REPS, { isRequired: true, isPrimary: true }),
      m(DISTANCE),
    ]);
    expect(r.compatible).toBe(true);
  });

  it('rejects a different default unit on a shared metric (case-insensitive compare)', () => {
    const bad = checkMetricCompatibility(strength, [
      m(REPS, { isRequired: true, isPrimary: true }),
      m(WEIGHT, { defaultUnit: 'kg' }),
    ]);
    expect(bad.reasons).toContainEqual({
      code: 'unit_mismatch',
      metricTypeId: WEIGHT,
    });
    const ok = checkMetricCompatibility(strength, [
      m(REPS, { isRequired: true, isPrimary: true }),
      m(WEIGHT, { defaultUnit: 'LBS' }),
    ]);
    expect(ok.compatible).toBe(true);
  });

  it('does not treat a missing unit on one side as a mismatch', () => {
    const r = checkMetricCompatibility(
      [m(WEIGHT, { isRequired: true, defaultUnit: 'lbs' })],
      [m(WEIGHT, { isRequired: true, defaultUnit: null })],
    );
    expect(r.compatible).toBe(true);
  });
});

describe('isAvailableAtLocation', () => {
  it('matches the mapped location', () => {
    expect(isAvailableAtLocation(['gym'], 'gym')).toBe(true);
    expect(isAvailableAtLocation(['gym'], 'home')).toBe(false);
  });

  it('treats the anywhere tag as available everywhere, and anywhere as unconstrained', () => {
    expect(isAvailableAtLocation(['anywhere'], 'outdoor')).toBe(true);
    expect(isAvailableAtLocation(['gym'], 'anywhere')).toBe(true);
    expect(isAvailableAtLocation([], 'home')).toBe(false);
  });
});

describe('filterTargetsForSubstitute', () => {
  it('drops targets of metrics the substitute does not track', () => {
    const targets = [{ metricTypeId: REPS }, { metricTypeId: WEIGHT }];
    expect(filterTargetsForSubstitute(targets, [m(REPS)])).toEqual([
      { metricTypeId: REPS },
    ]);
  });
});
