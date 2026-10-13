import {
  describeExternalError,
  externalCallMetrics,
  recordExternalCall,
} from './external-call-telemetry';

describe('external-call-telemetry (B11)', () => {
  beforeEach(() => externalCallMetrics.reset());

  const logger = () => ({ log: jest.fn(), error: jest.fn() });

  it('counts calls per service:operation and aggregates per service with a success rate', () => {
    const l = logger();
    recordExternalCall(l, {
      service: 'openai',
      operation: 'moderations.create',
      outcome: 'success',
      attempts: 1,
      durationMs: 10,
    });
    recordExternalCall(l, {
      service: 'openai',
      operation: 'moderations.create',
      outcome: 'success',
      attempts: 3,
      durationMs: 10,
    });
    recordExternalCall(l, {
      service: 'openai',
      operation: 'moderations.create',
      outcome: 'failure',
      attempts: 3,
      durationMs: 10,
      error: 'X',
    });
    recordExternalCall(l, {
      service: 'r2',
      operation: 'ListObjectsV2',
      outcome: 'success',
      attempts: 1,
      durationMs: 5,
    });
    recordExternalCall(l, {
      service: 'r2',
      operation: 'presign',
      outcome: 'failure',
      attempts: 1,
      durationMs: 1,
      error: 'Y',
    });

    const snapshot = externalCallMetrics.snapshot();
    expect(snapshot['openai:moderations.create']).toEqual({
      calls: 3,
      successes: 2,
      failures: 1,
      retries: 4,
      successRate: 2 / 3,
    });
    expect(snapshot.openai).toEqual(snapshot['openai:moderations.create']);
    expect(snapshot.r2).toEqual({
      calls: 2,
      successes: 1,
      failures: 1,
      retries: 0,
      successRate: 0.5,
    });
  });

  it('emits one structured line per call: log on success, error on failure', () => {
    const l = logger();
    recordExternalCall(l, {
      service: 'r2',
      operation: 'DeleteObjects',
      outcome: 'success',
      attempts: 2,
      durationMs: 12.7,
    });
    recordExternalCall(l, {
      service: 'r2',
      operation: 'DeleteObjects',
      outcome: 'failure',
      attempts: 2,
      durationMs: 30,
      error: 'TimeoutError',
    });

    expect(l.log).toHaveBeenCalledWith(
      'external_call service=r2 operation=DeleteObjects outcome=success attempts=2 durationMs=13',
    );
    expect(l.error).toHaveBeenCalledWith(
      'external_call service=r2 operation=DeleteObjects outcome=failure attempts=2 durationMs=30 error=TimeoutError',
    );
  });

  it('reports an empty, zero-rate snapshot after reset', () => {
    expect(externalCallMetrics.snapshot()).toEqual({});
  });

  describe('describeExternalError', () => {
    it('keeps the class name, HTTP status and provider code — never the message', () => {
      class RateLimitError extends Error {
        status = 429;
        code = 'rate_limit_exceeded';
      }
      const summary = describeExternalError(
        new RateLimitError('secret prompt text and sk-123'),
      );
      expect(summary).toBe(
        'RateLimitError status=429 code=rate_limit_exceeded',
      );
      expect(summary).not.toContain('secret');
    });

    it('reads the AWS SDK status from $metadata and the error name', () => {
      const error = Object.assign(new Error('Access Denied for key xyz'), {
        name: 'AccessDenied',
        $metadata: { httpStatusCode: 403 },
      });
      expect(describeExternalError(error)).toBe('AccessDenied status=403');
    });

    it('drops a code that is not a short identifier', () => {
      const error = Object.assign(new Error('x'), {
        name: 'ConnectionError',
        code: 'some free text with spaces',
      });
      expect(describeExternalError(error)).toBe('ConnectionError');
    });

    it('handles non-Error values', () => {
      expect(describeExternalError('boom')).toBe('UnknownError');
      expect(describeExternalError(undefined)).toBe('UnknownError');
    });
  });
});
