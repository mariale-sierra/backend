/**
 * @jest-environment ../test/jest-environment-node-fetch.js
 */
import { Logger, ServiceUnavailableException } from '@nestjs/common';
import { ModerationService, OPENAI_MAX_RETRIES } from './moderation.service';
import { externalCallMetrics } from '../common/external-call-telemetry';

/**
 * B11 — reliability of the OpenAI integration, exercised through the REAL
 * OpenAI SDK (its own retry/backoff loop included). Only the network is
 * faked: `fetch` is stubbed, so no request ever leaves the process. Error
 * responses carry `retry-after-ms: 1` so the SDK's backoff doesn't slow the
 * suite; the connection-error case uses the SDK's real default backoff.
 */

const SECRET_KEY = 'sk-test-b11-secret-do-not-log';
const USER_TEXT = 'texto privado del usuario b11';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'retry-after-ms': '1',
      'x-request-id': `req_${status}`,
    },
  });
}

const okBody = {
  id: 'modr-b11',
  model: 'omni-moderation-latest',
  results: [
    { flagged: false, categories: { violence: false }, category_scores: {} },
  ],
};

const errorBody = (status: number) => ({
  error: {
    message: `simulated ${status}`,
    type: 'server_error',
    code: status === 429 ? 'rate_limit_exceeded' : null,
  },
});

describe('ModerationService — B11 reliability (real OpenAI SDK, stubbed network)', () => {
  const originalKey = process.env.OPENAI_API_KEY;
  let service: ModerationService;
  let fetchSpy: jest.SpyInstance;
  let logSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    process.env.OPENAI_API_KEY = SECRET_KEY;
    externalCallMetrics.reset();
    service = new ModerationService();
    fetchSpy = jest.spyOn(globalThis, 'fetch');
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    errorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(() => {
    process.env.OPENAI_API_KEY = originalKey;
  });

  function allLoggedText(): string {
    return [logSpy, warnSpy, errorSpy]
      .flatMap((spy): unknown[] => spy.mock.calls.flat())
      .map((arg) => String(arg))
      .join('\n');
  }

  it('succeeds on the first attempt: one request, outcome logged, counted', async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(200, okBody));

    await expect(service.validateText(USER_TEXT)).resolves.toEqual({
      flagged: false,
      flaggedCategories: [],
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        'external_call service=openai operation=moderations.create outcome=success attempts=1',
      ),
    );
    expect(externalCallMetrics.snapshot().openai).toEqual({
      calls: 1,
      successes: 1,
      failures: 0,
      retries: 0,
      successRate: 1,
    });
  });

  it('recovers from a transient 503: the SDK retries, the failed attempt is logged, the call succeeds', async () => {
    fetchSpy
      .mockResolvedValueOnce(jsonResponse(503, errorBody(503)))
      .mockResolvedValueOnce(jsonResponse(200, okBody));

    await expect(service.validateText(USER_TEXT)).resolves.toMatchObject({
      flagged: false,
    });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringMatching(
        /OpenAI moderation attempt 1\/3 failed, retrying: .*status 503/,
      ),
    );
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('outcome=success attempts=2'),
    );
    expect(externalCallMetrics.snapshot().openai).toMatchObject({
      calls: 1,
      successes: 1,
      failures: 0,
      retries: 1,
    });
  });

  it('recovers from a rate limit (429) the same way', async () => {
    fetchSpy
      .mockResolvedValueOnce(jsonResponse(429, errorBody(429)))
      .mockResolvedValueOnce(jsonResponse(200, okBody));

    await expect(service.validateText(USER_TEXT)).resolves.toMatchObject({
      flagged: false,
    });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('gives up after the bounded number of attempts and fails closed with the existing 503', async () => {
    fetchSpy.mockImplementation(() =>
      Promise.resolve(jsonResponse(500, errorBody(500))),
    );

    await expect(service.validateText(USER_TEXT)).rejects.toThrow(
      ServiceUnavailableException,
    );

    expect(fetchSpy).toHaveBeenCalledTimes(OPENAI_MAX_RETRIES + 1);
    expect(warnSpy).toHaveBeenCalledTimes(OPENAI_MAX_RETRIES);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringMatching(
        /external_call service=openai operation=moderations\.create outcome=failure attempts=3 durationMs=\d+ error=InternalServerError status=500/,
      ),
    );
    expect(externalCallMetrics.snapshot().openai).toMatchObject({
      calls: 1,
      successes: 0,
      failures: 1,
      retries: 2,
      successRate: 0,
    });
  });

  it('never retries a non-recoverable 4xx (e.g. an invalid key): one attempt, then 503', async () => {
    fetchSpy.mockImplementation(() =>
      Promise.resolve(jsonResponse(401, errorBody(401))),
    );

    await expect(service.validateText(USER_TEXT)).rejects.toThrow(
      ServiceUnavailableException,
    );

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringMatching(/outcome=failure attempts=1 .*status=401/),
    );
  });

  it('retries a dropped connection with the SDK backoff and then succeeds', async () => {
    fetchSpy
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(jsonResponse(200, okBody));

    await expect(service.validateText(USER_TEXT)).resolves.toMatchObject({
      flagged: false,
    });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringMatching(
        /attempt 1\/3 failed, retrying: .*connection failed/,
      ),
    );
  });

  it('applies the same handling to image moderation (cron path): 503 after the bounded attempts', async () => {
    fetchSpy.mockImplementation(() =>
      Promise.resolve(jsonResponse(502, errorBody(502))),
    );

    await expect(
      service.validateWorkoutImage('https://img.example/x.jpg', USER_TEXT),
    ).rejects.toThrow(ServiceUnavailableException);
    expect(fetchSpy).toHaveBeenCalledTimes(OPENAI_MAX_RETRIES + 1);
  });

  it('never writes the API key or the user text to the logs', async () => {
    fetchSpy
      .mockResolvedValueOnce(jsonResponse(503, errorBody(503)))
      .mockImplementation(() =>
        Promise.resolve(jsonResponse(500, errorBody(500))),
      );

    await expect(service.validateText(USER_TEXT)).rejects.toThrow(
      ServiceUnavailableException,
    );

    const logged = allLoggedText();
    expect(logged.length).toBeGreaterThan(0);
    expect(logged).not.toContain(SECRET_KEY);
    expect(logged).not.toContain(USER_TEXT);
    // Provider error messages are not logged either (they can echo input).
    expect(logged).not.toContain('simulated 500');
  });
});
