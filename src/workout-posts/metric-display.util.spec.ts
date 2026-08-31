import {
  extractMetricValue,
  formatPrimaryMetric,
  pickPrimaryMetricCode,
  MetricValueRow,
} from './metric-display.util';

function row(overrides: Partial<MetricValueRow> = {}): MetricValueRow {
  return {
    metric_code: null,
    default_unit: null,
    target_value_int: null,
    target_value_decimal: null,
    target_value_seconds: null,
    ...overrides,
  };
}

describe('metric-display.util', () => {
  describe('extractMetricValue', () => {
    it('reads reps from target_value_int', () => {
      expect(
        extractMetricValue(row({ metric_code: 'reps', target_value_int: 12 })),
      ).toBe(12);
    });

    it('reads weight/distance from target_value_decimal', () => {
      expect(
        extractMetricValue(
          row({ metric_code: 'weight', target_value_decimal: 45.5 }),
        ),
      ).toBe(45.5);
      expect(
        extractMetricValue(
          row({ metric_code: 'distance', target_value_decimal: 3.2 }),
        ),
      ).toBe(3.2);
    });

    it('reads time from target_value_seconds', () => {
      expect(
        extractMetricValue(
          row({ metric_code: 'time', target_value_seconds: 90 }),
        ),
      ).toBe(90);
    });

    it('parses string-encoded numeric columns (node-pg returns numeric/bigint as strings)', () => {
      expect(
        extractMetricValue(
          row({ metric_code: 'reps', target_value_int: '12' }),
        ),
      ).toBe(12);
    });

    it('preserves a real 0 value rather than treating it as missing', () => {
      expect(
        extractMetricValue(
          row({ metric_code: 'distance', target_value_decimal: 0 }),
        ),
      ).toBe(0);
    });

    it('returns null for an unrecognized or missing metric code', () => {
      expect(extractMetricValue(row({ metric_code: null }))).toBeNull();
      expect(extractMetricValue(row({ metric_code: 'rounds' }))).toBeNull();
    });

    it('returns null when the column that applies for the code is itself null', () => {
      expect(extractMetricValue(row({ metric_code: 'reps' }))).toBeNull();
    });
  });

  describe('pickPrimaryMetricCode', () => {
    it('prefers time when distance is present (cardio)', () => {
      expect(pickPrimaryMetricCode(new Set(['time', 'distance']))).toBe('time');
    });

    it('prefers reps over weight when both are present (strength)', () => {
      expect(pickPrimaryMetricCode(new Set(['reps', 'weight']))).toBe('reps');
    });

    it('falls back to time when only time is present (flexibility/mind-body)', () => {
      expect(pickPrimaryMetricCode(new Set(['time']))).toBe('time');
    });

    it('falls through to whichever code is actually present, rather than dropping real data whose usual pair-mate is missing', () => {
      expect(pickPrimaryMetricCode(new Set(['weight']))).toBe('weight');
      expect(pickPrimaryMetricCode(new Set(['distance']))).toBe('distance');
    });

    it('returns null for an empty set', () => {
      expect(pickPrimaryMetricCode(new Set())).toBeNull();
    });
  });

  describe('formatPrimaryMetric', () => {
    it('formats reps as a bare number', () => {
      expect(
        formatPrimaryMetric([
          row({ metric_code: 'reps', target_value_int: 12 }),
        ]),
      ).toBe('12');
    });

    it("formats weight/distance with the metric_type's own default_unit, not a hardcoded one", () => {
      expect(
        formatPrimaryMetric([
          row({
            metric_code: 'weight',
            target_value_decimal: 45,
            default_unit: 'kg',
          }),
        ]),
      ).toBe('45 kg');
      expect(
        formatPrimaryMetric([
          row({
            metric_code: 'distance',
            target_value_decimal: 3,
            default_unit: 'mi',
          }),
        ]),
      ).toBe('3 mi');
    });

    it('formats a value with no default_unit as a bare number rather than crashing', () => {
      expect(
        formatPrimaryMetric([
          row({
            metric_code: 'weight',
            target_value_decimal: 45,
            default_unit: null,
          }),
        ]),
      ).toBe('45');
    });

    it('formats time under a minute as "Xs"', () => {
      expect(
        formatPrimaryMetric([
          row({ metric_code: 'time', target_value_seconds: 45 }),
        ]),
      ).toBe('45s');
    });

    it('formats time over a minute as "Xm Ys", or "Xm" with no leftover seconds', () => {
      expect(
        formatPrimaryMetric([
          row({ metric_code: 'time', target_value_seconds: 90 }),
        ]),
      ).toBe('1m 30s');
      expect(
        formatPrimaryMetric([
          row({ metric_code: 'time', target_value_seconds: 120 }),
        ]),
      ).toBe('2m');
    });

    it('picks the primary metric (time) over a secondary one (distance) present on the same rows', () => {
      expect(
        formatPrimaryMetric([
          row({ metric_code: 'time', target_value_seconds: 600 }),
          row({
            metric_code: 'distance',
            target_value_decimal: 2,
            default_unit: 'km',
          }),
        ]),
      ).toBe('10m');
    });

    it('returns null when the rows list is empty', () => {
      expect(formatPrimaryMetric([])).toBeNull();
    });

    it('returns null when the only rows present have no real value logged', () => {
      expect(
        formatPrimaryMetric([
          row({ metric_code: 'reps', target_value_int: null }),
        ]),
      ).toBeNull();
    });
  });
});
