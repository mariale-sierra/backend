import {
  REGISTER_THROTTLE_DEFAULT_LIMIT,
  registerThrottleLimit,
} from './auth.controller';

describe('register throttle limit (B4)', () => {
  it('defaults to 5 per IP when unset', () => {
    expect(registerThrottleLimit(undefined)).toBe(5);
    expect(REGISTER_THROTTLE_DEFAULT_LIMIT).toBe(5);
  });

  it('accepts a positive integer override (e2e suites)', () => {
    expect(registerThrottleLimit('100000')).toBe(100000);
  });

  // Post-audit: parseInt('abc') is NaN, and NaN as a limit disabled it.
  it.each(['', 'abc', '5x', '-1', '0', '2.5', 'NaN', 'Infinity'])(
    'falls back to the default for an invalid value %p instead of removing the limit',
    (value) => {
      expect(registerThrottleLimit(value)).toBe(5);
    },
  );
});
