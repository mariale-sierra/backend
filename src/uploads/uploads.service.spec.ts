import { Readable } from 'stream';
import {
  BadRequestException,
  InternalServerErrorException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { HttpResponse } from '@smithy/protocol-http';
import { S3ServiceException } from '@aws-sdk/client-s3';
import {
  DEFAULT_UPLOAD_MAX_BYTES,
  R2_MAX_ATTEMPTS,
  SIGNED_READ_TTL_SECONDS,
  UploadsService,
} from './uploads.service';
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

// B5 — CP2: raw HTTP responses for HeadObject / ranged GetObject / DeleteObject,
// same "real S3Client, stubbed network" approach as the rest of this file.
function headObjectResponse(contentLength: number) {
  return {
    response: new HttpResponse({
      statusCode: 200,
      headers: { 'content-length': String(contentLength) },
      body: Readable.from([]),
    }),
  };
}

/**
 * A real HeadObject 404 — confirmed locally (no R2 contact) to carry no body
 * (HEAD responses never do) and to deserialize into an error named `NotFound`
 * with `$metadata.httpStatusCode === 404`, unlike GetObject's `NoSuchKey`
 * (which does have an XML body — see the `s3Error(404, 'NoSuchKey')` calls
 * below). isNotFoundR2Error() checks httpStatusCode, not the name, precisely
 * so both shapes are covered without hardcoding either specific error name.
 */
function notFoundHeadResponse() {
  return {
    response: new HttpResponse({
      statusCode: 404,
      headers: {},
      body: Readable.from([]),
    }),
  };
}

function getObjectResponse(bytes: Buffer) {
  return {
    response: new HttpResponse({
      statusCode: 206,
      headers: { 'content-length': String(bytes.length) },
      body: Readable.from([bytes]),
    }),
  };
}

function deleteObjectResponse() {
  return {
    response: new HttpResponse({
      statusCode: 204,
      headers: {},
      body: Readable.from([]),
    }),
  };
}

// B5 — CP2: real magic bytes for the three allowed formats, plus the two
// abuse cases the sprint task names explicitly.
const VALID_JPEG_BYTES = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0,
]);
const VALID_PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0,
]);
const VALID_WEBP_BYTES = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.from([0, 0, 0, 0]),
  Buffer.from('WEBP'),
]);
/** An HTML file renamed to .jpeg — the sprint task's explicit abuse case. */
const HTML_RENAMED_AS_JPEG_BYTES = Buffer.from('<!DOCTYPE html><html>');
/** Too short / garbage — a truncated or corrupted upload. */
const TRUNCATED_BYTES = Buffer.from([0x00, 0x01]);

const ownUrl = (ext: string, name = 'abc') =>
  `https://cdn.example/uploads/user-1/${name}.${ext}`;

describe('UploadsService — B11 reliability (real S3Client, stubbed network)', () => {
  const env = process.env;
  let service: UploadsService;
  let handle: jest.Mock;
  let logSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;
  // B5 — CP2: a plain mock, not RedisCacheService itself — this suite is about
  // UploadsService's own logic, and RedisCacheService already has its own
  // spec covering its fail-open behavior. Defaults to "cache miss" (null),
  // same as a real, empty/disabled Redis; individual tests override `get`
  // when they need to exercise the declared-size link.
  let cache: { get: jest.Mock; set: jest.Mock; del: jest.Mock };

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
    cache = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined),
      del: jest.fn().mockResolvedValue(undefined),
    };
    service = new UploadsService(
      cache as unknown as ConstructorParameters<typeof UploadsService>[0],
    );
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
      const result = await service.getPresignedUrl(
        'image/jpeg',
        200_000,
        'user-1',
      );

      expect(result.key).toMatch(/^uploads\/user-1\/.+\.jpeg$/);
      expect(result.publicUrl).toBe(`https://cdn.example/${result.key}`);
      expect(result.signedUrl).toContain('X-Amz-Signature=');
      expect(handle).not.toHaveBeenCalled();
      expect(externalCallMetrics.snapshot()['r2:presign']).toMatchObject({
        calls: 1,
        successes: 1,
      });
    });

    // B5 — CP1: the signature itself (computed locally, no network — see the
    // class-level comment) now binds Content-Type and Content-Length. This only
    // verifies what the SDK signed, NOT whether R2 enforces a mismatch against the
    // real PUT body — that is unverified (CP0, not executed).
    it('lists content-type and content-length among the signed header NAMES', async () => {
      const result = await service.getPresignedUrl(
        'image/webp',
        123_456,
        'user-1',
      );

      const signedHeaders = new URL(result.signedUrl).searchParams.get(
        'X-Amz-SignedHeaders',
      );
      expect(signedHeaders).toContain('content-type');
      expect(signedHeaders).toContain('content-length');
    });

    // B5 — CP2: If-None-Match: '*' is signed too, so R2 (per its own docs — not
    // independently verified, CP0 is not authorized) refuses a second PUT to the
    // same key once the first one lands, closing the "swap the bytes after CP2
    // validated them" race while the 300s signed URL is still alive.
    it('also signs If-None-Match: * among the signed headers', async () => {
      const result = await service.getPresignedUrl(
        'image/jpeg',
        200_000,
        'user-1',
      );

      const signedHeaders = new URL(result.signedUrl).searchParams.get(
        'X-Amz-SignedHeaders',
      );
      expect(signedHeaders).toContain('if-none-match');
    });

    // B5 — CP1 follow-up verification: X-Amz-SignedHeaders only lists header
    // NAMES, never the values that were actually signed (that's how SigV4 query
    // signing works — the values are folded into the signature itself, not
    // exposed in the URL). To confirm the VALUES bound into the signature are
    // really the fileType/fileSize this call was given (not just that some
    // content-type/content-length happened to be present), this hooks the
    // request right before it is signed — the same 'build' step technique the
    // constructor already uses for the deserialize-step logger above — and
    // reads the real header values the signer saw. Still local-only: no network.
    it('signs the actual requested fileType/fileSize values, not just the header names', async () => {
      let seenHeaders: Record<string, string> = {};
      (
        service as unknown as {
          s3: {
            middlewareStack: {
              add: (
                step: unknown,
                opts: { step: string; name: string },
              ) => void;
            };
          };
        }
      ).s3.middlewareStack.add(
        (
          next: (args: {
            request: { headers: Record<string, string> };
          }) => Promise<unknown>,
        ) =>
          async (args: { request: { headers: Record<string, string> } }) => {
            seenHeaders = args.request.headers;
            return next(args);
          },
        { step: 'build', name: 'b5-cp1-probe' },
      );

      await service.getPresignedUrl('image/webp', 777_000, 'user-1');

      expect(seenHeaders['content-type']).toBe('image/webp');
      expect(seenHeaders['content-length']).toBe('777000');
      expect(seenHeaders['if-none-match']).toBe('*');

      // And a different request really does produce different signed values —
      // not a value fixed/cached from the first call.
      await service.getPresignedUrl('image/png', 42, 'user-1');
      expect(seenHeaders['content-type']).toBe('image/png');
      expect(seenHeaders['content-length']).toBe('42');
      expect(seenHeaders['if-none-match']).toBe('*');
    });

    it('rejects a fileSize over the configured ceiling before touching R2', async () => {
      await expect(
        service.getPresignedUrl(
          'image/jpeg',
          DEFAULT_UPLOAD_MAX_BYTES + 1,
          'user-1',
        ),
      ).rejects.toThrow(BadRequestException);

      expect(handle).not.toHaveBeenCalled();
      // No signing was ever attempted, so nothing should show up as an r2 call.
      expect(externalCallMetrics.snapshot()['r2:presign']).toBeUndefined();
    });

    it('accepts a fileSize exactly at the configured ceiling', async () => {
      const result = await service.getPresignedUrl(
        'image/png',
        DEFAULT_UPLOAD_MAX_BYTES,
        'user-1',
      );

      expect(result.key).toMatch(/^uploads\/user-1\/.+\.png$/);
    });

    it('respects UPLOAD_MAX_BYTES when set', async () => {
      process.env['UPLOAD_MAX_BYTES'] = '1000';

      await expect(
        service.getPresignedUrl('image/jpeg', 1001, 'user-1'),
      ).rejects.toThrow(BadRequestException);

      const result = await service.getPresignedUrl(
        'image/jpeg',
        1000,
        'user-1',
      );
      expect(result.key).toMatch(/^uploads\/user-1\/.+\.jpeg$/);
    });

    // B5 — CP2 (follow-up): the declared fileSize is linked to the object's
    // key in Redis, so verifyUploadedObject() can cross-check it later
    // without needing a DTO change on the posts/profile side.
    it('links the declared fileSize to the key in Redis for verifyUploadedObject() to cross-check later', async () => {
      const result = await service.getPresignedUrl(
        'image/webp',
        321_000,
        'user-1',
      );

      expect(cache.set).toHaveBeenCalledWith(
        `b5:upload-size:${result.key}`,
        321_000,
        expect.any(Number),
      );
    });

    it('maps a signing failure to the existing 500 and logs it', async () => {
      (
        service as unknown as {
          s3: { config: { credentials: () => Promise<never> } };
        }
      ).s3.config.credentials = () =>
        Promise.reject(new Error('credentials unavailable'));

      await expect(
        service.getPresignedUrl('image/png', 200_000, 'user-1'),
      ).rejects.toThrow(InternalServerErrorException);
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          'external_call service=r2 operation=presign outcome=failure attempts=1',
        ),
      );
    });
  });

  describe('verifyUploadedObject (B5 — CP2, real S3Client, stubbed network)', () => {
    it('accepts a real JPEG (HeadObject + magic bytes both pass)', async () => {
      handle
        .mockResolvedValueOnce(headObjectResponse(200_000))
        .mockResolvedValueOnce(getObjectResponse(VALID_JPEG_BYTES));

      await expect(
        service.verifyUploadedObject(ownUrl('jpeg'), 'user-1'),
      ).resolves.toBeUndefined();
      expect(handle).toHaveBeenCalledTimes(2); // HeadObject, GetObject — no delete
    });

    it('cleans up the declared-size Redis link once verification succeeds', async () => {
      const url = ownUrl('jpeg');
      const key = url.replace('https://cdn.example/', '');
      handle
        .mockResolvedValueOnce(headObjectResponse(200_000))
        .mockResolvedValueOnce(getObjectResponse(VALID_JPEG_BYTES));

      await service.verifyUploadedObject(url, 'user-1');

      expect(cache.del).toHaveBeenCalledWith(`b5:upload-size:${key}`);
    });

    // B5 — CP2 (follow-up): proves the Redis link from getPresignedUrl() is
    // what verifyUploadedObject() actually reads, end to end — not just that
    // an explicit expectedSizeBytes parameter works.
    it('rejects when the real size does not match the size Redis linked at sign time', async () => {
      cache.get.mockResolvedValueOnce(777); // what /uploads/sign declared
      handle
        .mockResolvedValueOnce(headObjectResponse(500)) // what R2 actually has
        .mockResolvedValueOnce(deleteObjectResponse());

      const url = ownUrl('jpeg');
      const key = url.replace('https://cdn.example/', '');
      await expect(service.verifyUploadedObject(url, 'user-1')).rejects.toThrow(
        BadRequestException,
      );
      expect(cache.get).toHaveBeenCalledWith(`b5:upload-size:${key}`);
    });

    // B5 — CP2 (accepted limitation, explicitly confirmed): when Redis is
    // unavailable, the declared-size cross-check is skipped — but the 5 MB
    // ceiling and the real-content checks (magic bytes) must keep applying
    // regardless. `cache.get` resolving null here is exactly what a down or
    // disabled RedisCacheService returns in production (it fails open by
    // design — see redis-cache.service.ts's own class doc comment), so this
    // group exercises the real "Redis unavailable" condition, not just an
    // incidental empty cache.
    describe('when Redis is unavailable (cache.get resolves null, same as RedisCacheService itself failing open)', () => {
      it('still accepts a valid upload within the ceiling', async () => {
        handle
          .mockResolvedValueOnce(headObjectResponse(200_000))
          .mockResolvedValueOnce(getObjectResponse(VALID_JPEG_BYTES));

        await expect(
          service.verifyUploadedObject(ownUrl('jpeg'), 'user-1'),
        ).resolves.toBeUndefined();
      });

      it('still rejects and deletes an object over the 5 MB ceiling', async () => {
        handle
          .mockResolvedValueOnce(
            headObjectResponse(DEFAULT_UPLOAD_MAX_BYTES + 1),
          )
          .mockResolvedValueOnce(deleteObjectResponse());

        await expect(
          service.verifyUploadedObject(ownUrl('jpeg'), 'user-1'),
        ).rejects.toThrow(BadRequestException);
        expect(handle).toHaveBeenCalledTimes(2); // HeadObject, DeleteObject
      });

      it('still rejects and deletes content whose real magic bytes are invalid', async () => {
        handle
          .mockResolvedValueOnce(headObjectResponse(1_000))
          .mockResolvedValueOnce(getObjectResponse(HTML_RENAMED_AS_JPEG_BYTES))
          .mockResolvedValueOnce(deleteObjectResponse());

        await expect(
          service.verifyUploadedObject(ownUrl('jpeg'), 'user-1'),
        ).rejects.toThrow(BadRequestException);
      });
    });

    it('accepts a real PNG', async () => {
      handle
        .mockResolvedValueOnce(headObjectResponse(200_000))
        .mockResolvedValueOnce(getObjectResponse(VALID_PNG_BYTES));

      await expect(
        service.verifyUploadedObject(ownUrl('png'), 'user-1'),
      ).resolves.toBeUndefined();
    });

    it('accepts a real WebP', async () => {
      handle
        .mockResolvedValueOnce(headObjectResponse(200_000))
        .mockResolvedValueOnce(getObjectResponse(VALID_WEBP_BYTES));

      await expect(
        service.verifyUploadedObject(ownUrl('webp'), 'user-1'),
      ).resolves.toBeUndefined();
    });

    it('rejects and deletes an object over the size ceiling, without reading its bytes', async () => {
      handle
        .mockResolvedValueOnce(headObjectResponse(DEFAULT_UPLOAD_MAX_BYTES + 1))
        .mockResolvedValueOnce(deleteObjectResponse());

      await expect(
        service.verifyUploadedObject(ownUrl('jpeg'), 'user-1', 'imageUrl'),
      ).rejects.toThrow(BadRequestException);
      // HeadObject, then straight to DeleteObject — never reads bytes of an
      // already-oversized object.
      expect(handle).toHaveBeenCalledTimes(2);
    });

    it('rejects when realSize does not match an explicit expectedSizeBytes', async () => {
      handle
        .mockResolvedValueOnce(headObjectResponse(500))
        .mockResolvedValueOnce(deleteObjectResponse());

      await expect(
        service.verifyUploadedObject(ownUrl('jpeg'), 'user-1', 'imageUrl', 501),
      ).rejects.toThrow(BadRequestException);
    });

    // The sprint task's explicit abuse case: real HTML content behind a
    // '.jpeg' key (the extension / declared Content-Type that was signed).
    it('rejects and deletes an HTML file renamed to .jpeg', async () => {
      handle
        .mockResolvedValueOnce(headObjectResponse(1_000))
        .mockResolvedValueOnce(getObjectResponse(HTML_RENAMED_AS_JPEG_BYTES))
        .mockResolvedValueOnce(deleteObjectResponse());

      await expect(
        service.verifyUploadedObject(ownUrl('jpeg'), 'user-1'),
      ).rejects.toThrow(BadRequestException);
      expect(handle).toHaveBeenCalledTimes(3);
    });

    it('rejects and deletes a truncated/garbage object (invalid magic bytes)', async () => {
      handle
        .mockResolvedValueOnce(headObjectResponse(2))
        .mockResolvedValueOnce(getObjectResponse(TRUNCATED_BYTES))
        .mockResolvedValueOnce(deleteObjectResponse());

      await expect(
        service.verifyUploadedObject(ownUrl('png'), 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects a declared type that does not match its real magic bytes even when valid for another format', async () => {
      // A real PNG sitting behind a key whose extension declared .webp.
      handle
        .mockResolvedValueOnce(headObjectResponse(1_000))
        .mockResolvedValueOnce(getObjectResponse(VALID_PNG_BYTES))
        .mockResolvedValueOnce(deleteObjectResponse());

      await expect(
        service.verifyUploadedObject(ownUrl('webp'), 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });

    // B5 — CP2 (follow-up): "object confirmed absent" (R2 itself says 404)
    // vs. "R2 couldn't be asked right now" need different handling — see
    // verifyUploadedObject's own doc comment for the reasoning.
    it('rejects with 400 (not 503) when HeadObject confirms the object does not exist, and never attempts a delete', async () => {
      handle.mockResolvedValueOnce(notFoundHeadResponse());

      await expect(
        service.verifyUploadedObject(ownUrl('jpeg'), 'user-1'),
      ).rejects.toThrow(BadRequestException);
      expect(handle).toHaveBeenCalledTimes(1); // no DeleteObject attempt
    });

    it('rejects with 503 (not 400) when HeadObject fails for a reason other than "not found", and never attempts a delete', async () => {
      handle.mockResolvedValueOnce(s3Error(403, 'AccessDenied'));

      await expect(
        service.verifyUploadedObject(ownUrl('jpeg'), 'user-1'),
      ).rejects.toThrow(ServiceUnavailableException);
      expect(handle).toHaveBeenCalledTimes(1); // no DeleteObject attempt
    });

    it('rejects with 400 (not 503) and does not delete when the object vanishes before the magic-byte read (GetObject 404)', async () => {
      handle
        .mockResolvedValueOnce(headObjectResponse(1_000))
        .mockResolvedValueOnce(s3Error(404, 'NoSuchKey'));

      await expect(
        service.verifyUploadedObject(ownUrl('jpeg'), 'user-1'),
      ).rejects.toThrow(BadRequestException);
      expect(handle).toHaveBeenCalledTimes(2); // no DeleteObject attempt
    });

    it('rejects with 503 (not 400) and does NOT delete when the magic-byte read fails for a reason other than "not found"', async () => {
      handle
        .mockResolvedValueOnce(headObjectResponse(1_000))
        .mockResolvedValueOnce(s3Error(500, 'InternalError'))
        .mockResolvedValueOnce(s3Error(500, 'InternalError')); // R2_MAX_ATTEMPTS retry

      await expect(
        service.verifyUploadedObject(ownUrl('jpeg'), 'user-1'),
      ).rejects.toThrow(ServiceUnavailableException);
      // HeadObject + 2 GetObject attempts — no DeleteObject: a transient
      // failure never destroys a possibly-still-valid object.
      expect(handle).toHaveBeenCalledTimes(3);
    });

    it('still rejects with the original validation error even if the cleanup delete itself fails', async () => {
      handle
        .mockResolvedValueOnce(headObjectResponse(DEFAULT_UPLOAD_MAX_BYTES + 1))
        .mockResolvedValueOnce(s3Error(403, 'AccessDenied')); // delete fails

      await expect(
        service.verifyUploadedObject(ownUrl('jpeg'), 'user-1'),
      ).rejects.toThrow(BadRequestException);
      // The delete failure is logged, not thrown/unhandled.
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('failed to delete rejected object'),
      );
    });

    it('is a no-op when R2 is not configured (nothing real to verify)', async () => {
      delete process.env['CLOUDFLARE_R2_PUBLIC_URL'];

      await expect(
        service.verifyUploadedObject('https://example.com/a.jpeg', 'user-1'),
      ).resolves.toBeUndefined();
      expect(handle).not.toHaveBeenCalled();
    });
  });

  describe('SIGNED_READ_TTL_SECONDS (B5 — CP4a, agreed TTLs)', () => {
    it('matches the TTLs agreed with Martin', () => {
      expect(SIGNED_READ_TTL_SECONDS.profile).toBe(24 * 60 * 60);
      expect(SIGNED_READ_TTL_SECONDS.space).toBe(24 * 60 * 60);
      expect(SIGNED_READ_TTL_SECONDS.postPublic).toBe(60 * 60);
      expect(SIGNED_READ_TTL_SECONDS.postFollowers).toBe(15 * 60);
      expect(SIGNED_READ_TTL_SECONDS.postPrivate).toBe(10 * 60);
    });
  });

  describe('toSignedReadUrl (B5 — CP4a, uncached — private/followers posts)', () => {
    it('returns null for a null or undefined stored URL', async () => {
      await expect(
        service.toSignedReadUrl(
          null,
          'user-1',
          SIGNED_READ_TTL_SECONDS.postPrivate,
        ),
      ).resolves.toBeNull();
      await expect(
        service.toSignedReadUrl(
          undefined,
          'user-1',
          SIGNED_READ_TTL_SECONDS.postPrivate,
        ),
      ).resolves.toBeNull();
      expect(handle).not.toHaveBeenCalled();
    });

    it('signs a real own-upload URL, with the real TTL, and never touches Redis', async () => {
      const result = await service.toSignedReadUrl(
        ownUrl('jpeg'),
        'user-1',
        SIGNED_READ_TTL_SECONDS.postPrivate,
      );

      expect(result).toContain('X-Amz-Signature=');
      expect(new URL(result!).searchParams.get('X-Amz-Expires')).toBe(
        String(SIGNED_READ_TTL_SECONDS.postPrivate),
      );
      expect(cache.get).not.toHaveBeenCalled();
      expect(cache.set).not.toHaveBeenCalled();
    });

    // B5 — CP4a: spaces.image_url is never validated against the R2 prefix
    // (only @IsUrl({})), so this must pass an unrelated URL through
    // untouched rather than fabricate a wrong signature for it.
    it("passes through a URL that is not one of this owner's R2 uploads, unchanged", async () => {
      const external = 'https://images.example.com/cover.jpg';
      await expect(
        service.toSignedReadUrl(
          external,
          'user-1',
          SIGNED_READ_TTL_SECONDS.space,
        ),
      ).resolves.toBe(external);
      expect(handle).not.toHaveBeenCalled();
    });

    it('passes the stored URL through unchanged when R2 is not configured', async () => {
      delete process.env['CLOUDFLARE_R2_PUBLIC_URL'];
      const stored = 'https://example.com/a.jpg';
      await expect(
        service.toSignedReadUrl(
          stored,
          'user-1',
          SIGNED_READ_TTL_SECONDS.postPrivate,
        ),
      ).resolves.toBe(stored);
    });

    it('returns null (not a thrown error) if signing itself fails', async () => {
      (
        service as unknown as {
          s3: { config: { credentials: () => Promise<never> } };
        }
      ).s3.config.credentials = () =>
        Promise.reject(new Error('credentials unavailable'));

      await expect(
        service.toSignedReadUrl(
          ownUrl('jpeg'),
          'user-1',
          SIGNED_READ_TTL_SECONDS.postPrivate,
        ),
      ).resolves.toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('failed to sign a read URL'),
      );
    });
  });

  describe('toCachedSignedReadUrl (B5 — CP4a, cached — profile/public post/space)', () => {
    it('signs and caches on a miss, with a Redis TTL strictly shorter than the signature', async () => {
      const result = await service.toCachedSignedReadUrl(
        ownUrl('jpeg'),
        'user-1',
        SIGNED_READ_TTL_SECONDS.postPublic,
      );

      expect(result).toContain('X-Amz-Signature=');
      expect(cache.get).toHaveBeenCalled();
      expect(cache.set).toHaveBeenCalledWith(
        expect.stringContaining('b5:read-url:'),
        result,
        expect.any(Number),
      );
      const setCall = cache.set.mock.calls[0] as unknown[];
      const cacheTtl = setCall[2] as number;
      expect(cacheTtl).toBeLessThan(SIGNED_READ_TTL_SECONDS.postPublic);
      expect(cacheTtl).toBeGreaterThan(0);
    });

    it('returns the cached value on a hit, without signing again', async () => {
      cache.get.mockResolvedValueOnce('https://cdn.example/already-signed');

      const result = await service.toCachedSignedReadUrl(
        ownUrl('jpeg'),
        'user-1',
        SIGNED_READ_TTL_SECONDS.profile,
      );

      expect(result).toBe('https://cdn.example/already-signed');
      expect(cache.set).not.toHaveBeenCalled();
    });

    it('still works (fails open to signing fresh) when Redis has nothing for this key', async () => {
      // beforeEach already defaults cache.get to resolve null.
      const result = await service.toCachedSignedReadUrl(
        ownUrl('png'),
        'user-1',
        SIGNED_READ_TTL_SECONDS.space,
      );

      expect(result).toContain('X-Amz-Signature=');
    });

    it('passes through a non-own-upload URL unchanged, without ever touching Redis', async () => {
      const external = 'https://images.example.com/cover.jpg';
      await expect(
        service.toCachedSignedReadUrl(
          external,
          'user-1',
          SIGNED_READ_TTL_SECONDS.space,
        ),
      ).resolves.toBe(external);
      expect(cache.get).not.toHaveBeenCalled();
      expect(cache.set).not.toHaveBeenCalled();
    });
  });

  describe('invalidateCachedReadUrl (B5 — CP4a, on post delete/hide)', () => {
    it('deletes the cached signed URL for the given key', async () => {
      const url = ownUrl('jpeg');
      const key = url.replace('https://cdn.example/', '');

      await service.invalidateCachedReadUrl(url, 'user-1');

      expect(cache.del).toHaveBeenCalledWith(`b5:read-url:${key}`);
    });

    it('is a no-op for a null URL or a non-own-upload URL', async () => {
      await service.invalidateCachedReadUrl(null, 'user-1');
      await service.invalidateCachedReadUrl(
        'https://images.example.com/cover.jpg',
        'user-1',
      );

      expect(cache.del).not.toHaveBeenCalled();
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
