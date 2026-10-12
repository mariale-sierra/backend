import { Readable } from 'stream';
import { InternalServerErrorException, Logger } from '@nestjs/common';
import { HttpResponse } from '@smithy/protocol-http';
import { S3ServiceException } from '@aws-sdk/client-s3';
import { R2_MAX_ATTEMPTS, UploadsService } from './uploads.service';
import { externalCallMetrics } from '../common/external-call-telemetry';

/**
 * B11 — reliability of the Cloudflare R2 integration, exercised through the
 * REAL S3Client (its own standard retry strategy and XML error parsing
 * included). Only the network is faked: the client's requestHandler is
 * replaced, so no request ever leaves the process.
 */

const SECRET_ACCESS_KEY = 'r2-secret-b11-do-not-log';
const ACCESS_KEY_ID = 'r2-access-key-id-b11';

function xmlResponse(statusCode: number, xml: string) {
  return {
    response: new HttpResponse({
      statusCode,
      headers: { 'content-type': 'application/xml' },
      body: Readable.from([Buffer.from(xml)]),
    }),
  };
}

const emptyListing = xmlResponse(
  200,
  `<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult><Name>bucket</Name><Prefix>uploads/u/</Prefix><KeyCount>0</KeyCount><MaxKeys>1000</MaxKeys><IsTruncated>false</IsTruncated></ListBucketResult>`,
);

const s3Error = (statusCode: number, code: string) =>
  xmlResponse(
    statusCode,
    `<?xml version="1.0" encoding="UTF-8"?><Error><Code>${code}</Code><Message>simulated ${code}</Message></Error>`,
  );

/** A Node-style network error, as node:dns / the HTTP handler raise it. */
const dnsError = (code: string) =>
  Object.assign(
    new Error(`getaddrinfo ${code} acct.r2.cloudflarestorage.com`),
    {
      code,
    },
  );

describe('UploadsService — B11 reliability (real S3Client, stubbed network)', () => {
  const env = process.env;
  let service: UploadsService;
  let handle: jest.Mock;
  let logSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    process.env = {
      ...env,
      CLOUDFLARE_R2_ACCOUNT_ID: 'acct',
      CLOUDFLARE_R2_ACCESS_KEY_ID: ACCESS_KEY_ID,
      CLOUDFLARE_R2_SECRET_ACCESS_KEY: SECRET_ACCESS_KEY,
      CLOUDFLARE_R2_BUCKET_NAME: 'bucket',
      CLOUDFLARE_R2_PUBLIC_URL: 'https://cdn.example',
    };
    externalCallMetrics.reset();
    service = new UploadsService();
    handle = jest.fn();
    (
      service as unknown as { s3: { config: { requestHandler: unknown } } }
    ).s3.config.requestHandler = { handle };
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    errorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
    process.env = env;
  });

  function allLoggedText(): string {
    return [logSpy, warnSpy, errorSpy]
      .flatMap((spy): unknown[] => spy.mock.calls.flat())
      .map((arg) => String(arg))
      .join('\n');
  }

  describe('deleteUserObjects (account purge — the backend’s network calls to R2)', () => {
    it('succeeds on the first attempt: one request, outcome logged, counted', async () => {
      handle.mockResolvedValueOnce(emptyListing);

      await expect(service.deleteUserObjects('user-1')).resolves.toBe(0);

      expect(handle).toHaveBeenCalledTimes(1);
      expect(warnSpy).not.toHaveBeenCalled();
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          'external_call service=r2 operation=ListObjectsV2 outcome=success attempts=1',
        ),
      );
      expect(externalCallMetrics.snapshot().r2).toEqual({
        calls: 1,
        successes: 1,
        failures: 0,
        retries: 0,
        successRate: 1,
      });
    });

    it('recovers from a transient 503: the SDK retries once, the failed attempt is logged', async () => {
      handle
        .mockResolvedValueOnce(s3Error(503, 'SlowDown'))
        .mockResolvedValueOnce(emptyListing);

      await expect(service.deleteUserObjects('user-1')).resolves.toBe(0);

      expect(handle).toHaveBeenCalledTimes(2);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringMatching(
          /R2 request attempt failed \(attempt=1; max=2\): .*status=503/,
        ),
      );
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('outcome=success attempts=2'),
      );
      expect(externalCallMetrics.snapshot().r2).toMatchObject({
        calls: 1,
        successes: 1,
        retries: 1,
      });
    });

    it('gives up after the bounded attempts and rethrows the SDK error unchanged', async () => {
      handle.mockImplementation(() =>
        Promise.resolve(s3Error(500, 'InternalError')),
      );

      const failure = service.deleteUserObjects('user-1');
      await expect(failure).rejects.toBeInstanceOf(S3ServiceException);
      await expect(failure).rejects.toMatchObject({ name: 'InternalError' });

      expect(handle).toHaveBeenCalledTimes(R2_MAX_ATTEMPTS);
      expect(warnSpy).toHaveBeenCalledTimes(R2_MAX_ATTEMPTS);
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringMatching(
          /external_call service=r2 operation=ListObjectsV2 outcome=failure attempts=2 durationMs=\d+ error=InternalError status=500/,
        ),
      );
      expect(externalCallMetrics.snapshot().r2).toMatchObject({
        calls: 1,
        successes: 0,
        failures: 1,
        successRate: 0,
      });
    });

    it('retries a temporary DNS failure (EAI_AGAIN) once and recovers', async () => {
      handle
        .mockRejectedValueOnce(dnsError('EAI_AGAIN'))
        .mockResolvedValueOnce(emptyListing);

      await expect(service.deleteUserObjects('user-1')).resolves.toBe(0);

      expect(handle).toHaveBeenCalledTimes(2);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringMatching(
          /R2 request attempt failed \(attempt=1; max=2\): .*code=EAI_AGAIN/,
        ),
      );
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          'operation=ListObjectsV2 outcome=success attempts=2',
        ),
      );
    });

    it('gives up on a persistent EAI_AGAIN after the bounded attempts (no infinite retry)', async () => {
      handle.mockImplementation(() => Promise.reject(dnsError('EAI_AGAIN')));

      await expect(service.deleteUserObjects('user-1')).rejects.toMatchObject({
        code: 'EAI_AGAIN',
      });

      expect(handle).toHaveBeenCalledTimes(R2_MAX_ATTEMPTS);
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringMatching(
          /operation=ListObjectsV2 outcome=failure attempts=2 .*code=EAI_AGAIN/,
        ),
      );
    });

    it('does not widen retries to other non-transient network codes', async () => {
      handle.mockImplementation(() =>
        Promise.reject(dnsError('ERR_INVALID_URL')),
      );

      await expect(service.deleteUserObjects('user-1')).rejects.toMatchObject({
        code: 'ERR_INVALID_URL',
      });

      expect(handle).toHaveBeenCalledTimes(1);
    });

    it('never retries a non-recoverable 403 (AccessDenied): one attempt, then the error', async () => {
      handle.mockImplementation(() =>
        Promise.resolve(s3Error(403, 'AccessDenied')),
      );

      await expect(service.deleteUserObjects('user-1')).rejects.toMatchObject({
        name: 'AccessDenied',
      });

      expect(handle).toHaveBeenCalledTimes(1);
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringMatching(
          /outcome=failure attempts=1 .*AccessDenied status=403/,
        ),
      );
    });
  });

  describe('getPresignedUrl (local signing, no network)', () => {
    it('signs locally without calling R2 and counts the success', async () => {
      const result = await service.getPresignedUrl('image/jpeg', 'user-1');

      expect(result.key).toMatch(/^uploads\/user-1\/.+\.jpeg$/);
      expect(result.publicUrl).toBe(`https://cdn.example/${result.key}`);
      expect(result.signedUrl).toContain('X-Amz-Signature=');
      expect(handle).not.toHaveBeenCalled();
      expect(externalCallMetrics.snapshot()['r2:presign']).toMatchObject({
        calls: 1,
        successes: 1,
      });
    });

    it('maps a signing failure to the existing 500 and logs it', async () => {
      (
        service as unknown as {
          s3: { config: { credentials: () => Promise<never> } };
        }
      ).s3.config.credentials = () =>
        Promise.reject(new Error('credentials unavailable'));

      await expect(
        service.getPresignedUrl('image/png', 'user-1'),
      ).rejects.toThrow(InternalServerErrorException);
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          'external_call service=r2 operation=presign outcome=failure attempts=1',
        ),
      );
    });
  });

  it('never writes R2 credentials or the provider error message to the logs', async () => {
    handle.mockImplementation(() =>
      Promise.resolve(s3Error(500, 'InternalError')),
    );

    await expect(service.deleteUserObjects('user-1')).rejects.toBeDefined();

    const logged = allLoggedText();
    expect(logged.length).toBeGreaterThan(0);
    expect(logged).not.toContain(SECRET_ACCESS_KEY);
    expect(logged).not.toContain(ACCESS_KEY_ID);
    expect(logged).not.toContain('simulated InternalError');
  });
});
