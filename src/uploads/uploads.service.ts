import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { v4 as uuidv4 } from 'uuid';
import type { Readable } from 'stream';
import {
  describeExternalError,
  recordExternalCall,
} from '../common/external-call-telemetry';
import { extractUploadKey } from './upload-url.util';
import type { AllowedUploadFileType } from './dto/sign-upload.dto';
import { RedisCacheService } from '../cache/redis-cache.service';

/**
 * B11 — total attempts per R2 request (1 try + 1 retry). Retries are the AWS
 * SDK's own standard strategy (exponential backoff with jitter, only for
 * throttling / transient 5xx / timeouts / connection errors — never for
 * 4xx such as AccessDenied or NoSuchBucket), so no second retry layer is
 * added here. The value and the timeouts below were already in place; B11
 * adds logging and success/error accounting around them, plus
 * EXTRA_TRANSIENT_NETWORK_CODES below.
 */
export const R2_MAX_ATTEMPTS = 2;

/**
 * Node network error codes the SDK's classifier
 * (@smithy/service-error-classification) does NOT treat as transient, but
 * which are: EAI_AGAIN is getaddrinfo's "temporary failure, try again" (a
 * DNS hiccup), while the SDK only lists ENOTFOUND/EHOSTUNREACH/ENETUNREACH
 * and ECONNRESET/ECONNREFUSED/EPIPE/ETIMEDOUT. Errors with these codes are
 * tagged with the SDK's own `$retryable` trait so its standard strategy
 * retries them like any other transient error — same R2_MAX_ATTEMPTS bound,
 * same backoff; no extra retry loop.
 */
export const EXTRA_TRANSIENT_NETWORK_CODES: readonly string[] = ['EAI_AGAIN'];

/** B5 — CP1 default ceiling on an uploaded photo, used when UPLOAD_MAX_BYTES isn't set. */
export const DEFAULT_UPLOAD_MAX_BYTES = 5 * 1024 * 1024;

/**
 * B5 — the configurable ceiling, read lazily (same pattern as the R2_* env vars
 * elsewhere in this file) so it reflects the final loaded env rather than whatever
 * was set when this module was first imported (ConfigModule.forRoot() only runs once
 * Nest instantiates AppModule, which is after this file's top-level code already ran).
 * Falls back to DEFAULT_UPLOAD_MAX_BYTES on anything not a positive number.
 */
export function getUploadMaxBytes(): number {
  const raw = Number(process.env['UPLOAD_MAX_BYTES']);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_UPLOAD_MAX_BYTES;
}

/**
 * B5 — CP2: how long the fileSize declared at /uploads/sign time (CP1) is
 * remembered so verifyUploadedObject() can cross-check it against the real
 * size later — see getPresignedUrl()/verifyUploadedObject() and the
 * `declaredSizeCacheKey` helper below. Generous relative to the 300s PUT
 * presign window: covers a slow mobile upload plus the time until the client
 * calls back to attach the photo, without lingering long after.
 */
export const DECLARED_SIZE_CACHE_TTL_SECONDS = 15 * 60;

/** B5 — CP2: Redis key for the declared-fileSize link (see above). Never the
 * source of truth — RedisCacheService already fails open if Redis is down,
 * which here just means that one extra cross-check is skipped (the hard
 * ceiling in verifyUploadedObject still always applies either way). */
function declaredSizeCacheKey(key: string): string {
  return `b5:upload-size:${key}`;
}

/**
 * B5 — CP4a: signed-GET lifetimes, as agreed. Longer for content that is
 * either non-sensitive (profile — already visible to any authenticated user
 * regardless of profile privacy, an existing, unrelated-to-B5 decision) or
 * has no per-post revocation case today (spaces — same reasoning as
 * profile). Short for anything a report/hide/self-delete can make
 * invisible, so a URL already handed out can't outlive that by much — see
 * the Redis cache TTLs below for how "public" stays revocable too.
 */
export const SIGNED_READ_TTL_SECONDS = {
  profile: 24 * 60 * 60, // 86400
  space: 24 * 60 * 60, // 86400 — same treatment as profile, see D4/D5
  postPublic: 60 * 60, // 3600
  postFollowers: 15 * 60, // 900
  postPrivate: 10 * 60, // 600
  /** CP4a — moderatePostViaAi(): generous relative to one OpenAI call, far
   * short of anything that would matter if it leaked (and it never reaches
   * any API response — see the moderation section below). */
  moderation: 10 * 60, // 600
} as const;

/**
 * B5 — CP4a: Redis TTL for a cached signed GET, strictly shorter than the
 * signature's own lifetime above — margin-based, not a fixed number, so this
 * stays correct if SIGNED_READ_TTL_SECONDS ever changes. Redis itself never
 * returns an expired key (native `EX`), so whatever this cache answers with
 * is structurally guaranteed to still be a valid, unexpired signed URL — see
 * uploads.service.spec.ts's `expect(cacheTtl).toBeLessThan(signTtl)` tests.
 * Only used for profile/postPublic/space — CP2's own "never cache
 * private/followers" decision stays unchanged by this constant existing.
 */
function cachedReadTtlSeconds(signTtlSeconds: number): number {
  const margin = Math.min(10 * 60, Math.floor(signTtlSeconds / 6));
  return signTtlSeconds - margin;
}

/** B5 — CP4a: Redis key for a cached signed GET — shared across every
 * viewer of the same object, which is exactly why this is only used for
 * public/non-viewer-specific content (see cachedReadTtlSeconds' doc comment
 * and each call site). */
function signedReadCacheKey(key: string): string {
  return `b5:read-url:${key}`;
}

/**
 * B5 — CP2: the file extension getPresignedUrl() puts on a key
 * (`fileType.split('/')[1]`, so always 'jpeg' | 'png' | 'webp' — never 'jpg')
 * is the "declared Content-Type" for an object that has already been through
 * a signed upload: it is embedded in the object's own key, so it's always
 * available, unlike the sign-time fileSize (not persisted anywhere — see the
 * expectedSizeBytes note on verifyUploadedObject below).
 */
const EXTENSION_TO_DECLARED_TYPE: Record<string, AllowedUploadFileType> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

/**
 * B5 — CP2: real magic-byte signatures for the only three formats this
 * module ever signs an upload for. Checked against the first bytes actually
 * stored in R2 — never trusts the declared Content-Type or the file
 * extension on its own. Only enough bytes to tell the three apart (12 — WebP
 * needs 'RIFF' at 0-3 and 'WEBP' at 8-11) are ever read from R2 (a ranged
 * GetObject), not the whole file.
 */
const MAGIC_BYTE_CHECKS: Record<AllowedUploadFileType, (b: Buffer) => boolean> =
  {
    'image/jpeg': (b) =>
      b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
    'image/png': (b) =>
      b.length >= 8 &&
      b[0] === 0x89 &&
      b[1] === 0x50 &&
      b[2] === 0x4e &&
      b[3] === 0x47 &&
      b[4] === 0x0d &&
      b[5] === 0x0a &&
      b[6] === 0x1a &&
      b[7] === 0x0a,
    'image/webp': (b) =>
      b.length >= 12 &&
      b.subarray(0, 4).toString('ascii') === 'RIFF' &&
      b.subarray(8, 12).toString('ascii') === 'WEBP',
  };

/** Reads a (small, already range-limited) R2 object body stream into a Buffer. */
async function readStreamToBuffer(body: unknown): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of body as Readable) {
    chunks.push(
      Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array),
    );
  }
  return Buffer.concat(chunks);
}

/**
 * B5 — CP2: "object genuinely doesn't exist" vs. "R2 couldn't be asked right
 * now" need different handling (see verifyUploadedObject). Confirmed locally,
 * no R2 contact — HeadObject synthesizes a `NotFound` error with no body (HEAD
 * responses never carry one) while GetObject returns the usual XML `NoSuchKey`
 * — but BOTH carry `$metadata.httpStatusCode === 404`, which is the one
 * reliable signal shared by both commands' SDK outputs, so that's what this
 * checks rather than matching specific error names/codes.
 */
function isNotFoundR2Error(error: unknown): boolean {
  return (
    (error as { $metadata?: { httpStatusCode?: number } } | undefined)
      ?.$metadata?.httpStatusCode === 404
  );
}

type R2Output = { $metadata: { attempts?: number } };

@Injectable()
export class UploadsService {
  private readonly logger = new Logger(UploadsService.name);

  private s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${process.env['CLOUDFLARE_R2_ACCOUNT_ID']}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env['CLOUDFLARE_R2_ACCESS_KEY_ID'] as string,
      secretAccessKey: process.env['CLOUDFLARE_R2_SECRET_ACCESS_KEY'] as string,
    },
    // Bounded waits: account purges call R2 from a cron, and an unresponsive
    // endpoint must fail (and be retried next hour), not hang the job.
    requestHandler: { connectionTimeout: 5000, requestTimeout: 20000 },
    maxAttempts: R2_MAX_ATTEMPTS,
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });

  constructor(private readonly cache: RedisCacheService) {
    // Runs once per HTTP attempt: the SDK's retry middleware
    // (finalizeRequest step) wraps the deserialize step, so a failure here
    // is one failed attempt, retried or not. `amz-sdk-request` is the SDK's
    // own "attempt=N; max=M" header for that attempt. Only the error class /
    // status / code are logged — never credentials, keys or bodies. It is
    // also where EXTRA_TRANSIENT_NETWORK_CODES get the `$retryable` trait,
    // before the retry middleware classifies the error.
    this.s3.middlewareStack.add(
      (next) => async (args) => {
        try {
          return await next(args);
        } catch (error) {
          const networkError = error as {
            code?: unknown;
            $retryable?: { throttling?: boolean };
          };
          if (
            typeof networkError?.code === 'string' &&
            EXTRA_TRANSIENT_NETWORK_CODES.includes(networkError.code) &&
            networkError.$retryable === undefined
          ) {
            networkError.$retryable = { throttling: false };
          }
          const headers = (
            args.request as { headers?: Record<string, string> } | undefined
          )?.headers;
          this.logger.warn(
            `R2 request attempt failed (${headers?.['amz-sdk-request'] ?? 'attempt=?'}): ${describeExternalError(error)}`,
          );
          throw error;
        }
      },
      {
        step: 'deserialize',
        priority: 'high',
        name: 'havitR2AttemptFailureLogger',
      },
    );
  }

  /** Records one finished R2 call (outcome log line + counters). Rethrows
   * the SDK's own error unchanged so callers keep their current handling. */
  private async r2Call<T extends R2Output>(
    operation: string,
    call: () => Promise<T>,
  ): Promise<T> {
    const startedAt = Date.now();
    try {
      const output = await call();
      recordExternalCall(this.logger, {
        service: 'r2',
        operation,
        outcome: 'success',
        attempts: output.$metadata?.attempts ?? 1,
        durationMs: Date.now() - startedAt,
      });
      return output;
    } catch (error) {
      recordExternalCall(this.logger, {
        service: 'r2',
        operation,
        outcome: 'failure',
        attempts:
          (error as { $metadata?: { attempts?: number } }).$metadata
            ?.attempts ?? 1,
        durationMs: Date.now() - startedAt,
        error: describeExternalError(error),
      });
      throw error;
    }
  }

  async getPresignedUrl(fileType: string, fileSize: number, userId: string) {
    // B5 — CP1: reject an oversized request before doing any signing or
    // touching R2. This bounds what the CLIENT declares up front; it is not
    // yet a guarantee about the bytes actually PUT with the resulting URL
    // (that real-content check is CP2 — HeadObject + magic bytes — not part
    // of CP1). Not verified experimentally whether R2 itself also enforces
    // the signed ContentLength against the real PUT body (see CP0, not run).
    const maxBytes = getUploadMaxBytes();
    if (fileSize > maxBytes) {
      throw new BadRequestException(
        `fileSize must be at most ${maxBytes} bytes`,
      );
    }

    const extension = fileType.split('/')[1];
    // Scope the object key with the owning user id so uploads are
    // attributable and one user can't overwrite/guess another's key.
    const key = `uploads/${userId}/${uuidv4()}.${extension}`;

    // Presigning is local signing (no network round trip to R2), so it is
    // never retried: a failure here means missing/invalid configuration or
    // credentials. It is still logged and counted (operation=presign) so a
    // misconfigured deploy shows up in the same external_call lines.
    const startedAt = Date.now();
    try {
      const command = new PutObjectCommand({
        Bucket: process.env['CLOUDFLARE_R2_BUCKET_NAME'],
        Key: key,
        // B5 — CP1: sign the exact Content-Type and Content-Length so the
        // client's PUT must match both or the request fails (see upload.service.ts
        // in frontend, which now sends the same Content-Type header).
        ContentType: fileType,
        ContentLength: fileSize,
        // B5 — CP2: `key` is always a fresh uuidv4() (above), so there is never a
        // legitimate reason to PUT to it twice. This blocks the exact race CP2
        // exists to close: a client validated by the post-upload check (HeadObject
        // + magic bytes, below) re-PUTting different bytes to the same key while
        // the signed URL is still within its 300s window. Cloudflare's R2 docs
        // (developers.cloudflare.com/r2/api/s3/api/) confirm PutObject's
        // conditional headers — If-Match/If-None-Match — are supported and
        // "evaluated atomically"; for a concurrent or later PutObject with
        // If-None-Match: '*' against a key that already has an object, "at most
        // one write succeeds and the others fail with 412 PreconditionFailed".
        // Not independently verified against the real R2 bucket (CP0 is not
        // authorized) — this is Cloudflare's own documented guarantee, not ours.
        IfNoneMatch: '*',
      });

      const signedUrl = await getSignedUrl(this.s3, command, {
        expiresIn: 300,
        // @aws-sdk/s3-request-presigner always treats content-type as
        // unsignable for a presigned PUT (S3RequestPresigner.prepareRequest
        // hardcodes `unsignableHeaders.add('content-type')` — confirmed by
        // reading node_modules/@aws-sdk/s3-request-presigner's source, not
        // assumed). `signableHeaders` is the SDK's own documented override
        // for exactly this ("overrides those provided via unsignableHeaders,
        // allowing them to be signed" — @smithy/types' RequestSigningArguments).
        // Content-Length and If-None-Match need no such override: neither is on
        // that exclusion list, so both are already part of X-Amz-SignedHeaders
        // by default — confirmed locally the same way (see uploads.service.spec.ts).
        signableHeaders: new Set(['content-type']),
      });

      const publicUrl = `${process.env['CLOUDFLARE_R2_PUBLIC_URL']}/${key}`;

      // B5 — CP2: remember the declared fileSize against this key so
      // verifyUploadedObject() can cross-check it later (see
      // declaredSizeCacheKey's own comment — best-effort, never required).
      await this.cache.set(
        declaredSizeCacheKey(key),
        fileSize,
        DECLARED_SIZE_CACHE_TTL_SECONDS,
      );

      recordExternalCall(this.logger, {
        service: 'r2',
        operation: 'presign',
        outcome: 'success',
        attempts: 1,
        durationMs: Date.now() - startedAt,
      });
      return { signedUrl, publicUrl, key };
    } catch (error) {
      recordExternalCall(this.logger, {
        service: 'r2',
        operation: 'presign',
        outcome: 'failure',
        attempts: 1,
        durationMs: Date.now() - startedAt,
        error: describeExternalError(error),
      });
      throw new InternalServerErrorException(
        'Failed to generate signed upload URL',
      );
    }
  }

  /**
   * B5 — CP2: the real-content check that runs once the client reports "I
   * uploaded it" and BEFORE the URL is persisted on a profile or post — the
   * object in R2 is only ever trusted once this passes.
   *
   * Call this AFTER assertOwnUploadUrl(url, userId, field) already validated
   * ownership/shape of `url` — this does no ownership checking of its own
   * (see extractUploadKey's own doc comment). It:
   *   1. HeadObject: the object must exist, and its REAL size (not whatever a
   *      client claimed at sign time) must be within getUploadMaxBytes().
   *   2. Cross-checks that real size against the fileSize declared at
   *      /uploads/sign time (CP1), linked through Redis by R2 key — see
   *      declaredSizeCacheKey(). `expectedSizeBytes` can still be passed
   *      explicitly to override/force this (e.g. a future caller that
   *      carries its own declared size through some other path); when
   *      neither the cache nor the parameter has a value, only the ceiling
   *      from (1) applies — this never blocks on a missing link, it only
   *      loses the extra exact-match check (same fail-open behavior
   *      RedisCacheService already documents for itself).
   *   3. Reads the real magic bytes (a 12-byte ranged GetObject — never the
   *      whole file) and checks them against the Content-Type the object's
   *      OWN key declares (its extension — see EXTENSION_TO_DECLARED_TYPE).
   *
   * A CONFIRMED-invalid object (wrong size, wrong magic bytes, unrecognized
   * extension) is deleted and rejected with 400 — never left referenced by a
   * post or profile. A CONFIRMED-absent object (R2 itself says 404 — nothing
   * was ever actually uploaded to this key) is rejected with 400 too, but
   * there is nothing to delete. An R2 failure that is NEITHER of those
   * (timeout, 5xx, access/config problems) can't be told apart from "maybe
   * this object is actually fine" — it is rejected with 503 (ask the client
   * to retry), the object is left untouched, and nothing is deleted: deleting
   * on a failure we can't attribute to the content itself would risk
   * destroying a legitimately valid upload over a transient R2 hiccup.
   *
   * When R2 isn't configured (local dev/tests), extractUploadKey() returns
   * null and this is a no-op — there is no real object to check in that mode,
   * same degraded behavior assertOwnUploadUrl() already has.
   */
  async verifyUploadedObject(
    url: string,
    userId: string,
    field = 'imageUrl',
    expectedSizeBytes?: number,
  ): Promise<void> {
    const key = extractUploadKey(url, userId);
    if (key === null) return;

    const Bucket = process.env['CLOUDFLARE_R2_BUCKET_NAME'];
    const extension = key.split('.').pop() ?? '';
    const declaredType = EXTENSION_TO_DECLARED_TYPE[extension];

    if (!declaredType) {
      // The key was built by getPresignedUrl() from one of the three allowed
      // types, so this should be unreachable in practice — guard against it
      // anyway rather than ever running a magic-byte check for an unknown type.
      await this.rejectUploadedObject(Bucket, key);
      throw new BadRequestException(
        `${field} has an unrecognized file extension`,
      );
    }

    let realSize: number | undefined;
    try {
      const head = await this.r2Call('HeadObject', () =>
        this.s3.send(new HeadObjectCommand({ Bucket, Key: key })),
      );
      realSize = head.ContentLength;
    } catch (error) {
      if (isNotFoundR2Error(error)) {
        throw new BadRequestException(`${field} was not found`);
      }
      // A real R2 problem, not "this upload is invalid" — nothing to delete,
      // nothing confirmed bad; ask the client to retry instead of rejecting
      // content we never actually got to look at.
      this.logger.warn(
        `B5 CP2: HeadObject failed (not a 404) for ${field}, treating as a transient R2 problem: ${describeExternalError(error)}`,
      );
      throw new ServiceUnavailableException(
        `${field} could not be verified right now — try again`,
      );
    }

    const declaredSize =
      expectedSizeBytes ??
      (await this.cache.get<number>(declaredSizeCacheKey(key))) ??
      undefined;

    const maxBytes = getUploadMaxBytes();
    if (
      realSize === undefined ||
      realSize > maxBytes ||
      (declaredSize !== undefined && realSize !== declaredSize)
    ) {
      await this.rejectUploadedObject(Bucket, key);
      throw new BadRequestException(`${field} does not have the expected size`);
    }

    let bytes: Buffer;
    try {
      const rangeResult = await this.r2Call('GetObject', () =>
        this.s3.send(
          new GetObjectCommand({ Bucket, Key: key, Range: 'bytes=0-11' }),
        ),
      );
      bytes = await readStreamToBuffer(rangeResult.Body);
    } catch (error) {
      if (isNotFoundR2Error(error)) {
        // Vanished between HeadObject and this GetObject (e.g. deleted
        // concurrently) — genuinely nothing left to delete or accept.
        throw new BadRequestException(`${field} was not found`);
      }
      this.logger.warn(
        `B5 CP2: GetObject (magic bytes) failed (not a 404) for ${field}, treating as a transient R2 problem: ${describeExternalError(error)}`,
      );
      throw new ServiceUnavailableException(
        `${field} could not be verified right now — try again`,
      );
    }

    if (!MAGIC_BYTE_CHECKS[declaredType](bytes)) {
      await this.rejectUploadedObject(Bucket, key);
      throw new BadRequestException(
        `${field} does not match a supported image format`,
      );
    }

    // Verified — the declared-size link has done its job (or was never
    // there); no need to keep it in Redis until its own TTL.
    await this.cache.del(declaredSizeCacheKey(key));
  }

  /**
   * B5 — CP2: best-effort cleanup for a CONFIRMED-invalid object
   * verifyUploadedObject() rejected. Logged, never thrown — a delete failure
   * must not mask the real 400 the caller is about to raise, and must not
   * turn a validation failure into a 500; the invariant that matters
   * (invalid content is never referenced by a post/profile) still holds
   * either way, since the caller's row is never written.
   *
   * ORPHAN RISK (open, documented — not fixed here): if this delete itself
   * fails, the rejected object is left in R2 indefinitely — nothing in this
   * codebase retries it later. The exposure is bounded (it is never
   * referenced by any DB row, so it is never served to anyone; once CP4b
   * lands it also sits in a bucket nobody can read without a signed URL that
   * will never be minted for an unreferenced key) — it is a storage-cost/
   * hygiene issue, not a privacy one.
   *
   * REJECTED as a fix: an R2 Object Lifecycle rule (age-based expiration,
   * confirmed supported — developers.cloudflare.com/r2/buckets/object-lifecycles/)
   * scoped to the whole `uploads/` prefix. That prefix also holds every
   * legitimate profile photo and approved post image — R2's lifecycle rules
   * expire by age/prefix only, with no concept of "is this still referenced
   * by a row in Postgres", so a blanket rule would eventually delete real,
   * in-use user photos too, not just orphans. Do not add one scoped this way.
   *
   * The correct fix needs to check DB references before deleting anything —
   * e.g. a periodic job that lists `uploads/` objects and only removes ones
   * with no matching `profile_image_url`/`image_url` row — which is real
   * application logic (a new cron, similar in shape to the moderation batch
   * job), not a bucket setting, and is explicitly out of this session's
   * authorized scope. Left as a pending risk for a future, separately
   * authorized checkpoint.
   */
  private async rejectUploadedObject(
    Bucket: string | undefined,
    Key: string,
  ): Promise<void> {
    try {
      await this.r2Call('DeleteObject', () =>
        this.s3.send(new DeleteObjectCommand({ Bucket, Key })),
      );
    } catch (error) {
      this.logger.warn(
        `B5 CP2: failed to delete rejected object ${Key}: ${describeExternalError(error)}`,
      );
    }
  }

  /**
   * Deletes every object under `uploads/<userId>/` (the key scheme
   * getPresignedUrl() uses), i.e. all photos the user ever uploaded. Used by
   * account deletion. Returns how many objects were removed. Throws on any
   * storage error so the caller can retry instead of marking the purge done.
   */
  async deleteUserObjects(userId: string): Promise<number> {
    const Bucket = process.env['CLOUDFLARE_R2_BUCKET_NAME'];
    const Prefix = `uploads/${userId}/`;
    let deleted = 0;
    let ContinuationToken: string | undefined;

    do {
      const page = await this.r2Call('ListObjectsV2', () =>
        this.s3.send(
          new ListObjectsV2Command({ Bucket, Prefix, ContinuationToken }),
        ),
      );
      const keys = (page.Contents ?? []).flatMap((o) =>
        o.Key ? [{ Key: o.Key }] : [],
      );
      if (keys.length > 0) {
        const result = await this.r2Call('DeleteObjects', () =>
          this.s3.send(
            new DeleteObjectsCommand({
              Bucket,
              Delete: { Objects: keys, Quiet: true },
            }),
          ),
        );
        if (result.Errors?.length) {
          throw new Error(
            `R2 failed to delete ${result.Errors.length} object(s) for user ${userId}`,
          );
        }
        deleted += keys.length;
      }
      ContinuationToken = page.IsTruncated
        ? page.NextContinuationToken
        : undefined;
    } while (ContinuationToken);

    return deleted;
  }

  /**
   * B5 — CP4a: signs a GET for `key`, local signing only (no network — same
   * as every other presign in this file), logged/counted the same way as
   * getPresignedUrl()'s own signing step. Failures here mean missing/invalid
   * R2 config, not "this photo is bad" — callers treat a null return as
   * "couldn't resolve this image right now", not an error worth failing an
   * entire feed/profile response over (one broken photo must not 500 a page
   * of otherwise-fine ones).
   */
  private async signKey(
    key: string,
    ttlSeconds: number,
  ): Promise<string | null> {
    const Bucket = process.env['CLOUDFLARE_R2_BUCKET_NAME'];
    const startedAt = Date.now();
    try {
      const signedUrl = await getSignedUrl(
        this.s3,
        new GetObjectCommand({ Bucket, Key: key }),
        { expiresIn: ttlSeconds },
      );
      recordExternalCall(this.logger, {
        service: 'r2',
        operation: 'presign-read',
        outcome: 'success',
        attempts: 1,
        durationMs: Date.now() - startedAt,
      });
      return signedUrl;
    } catch (error) {
      recordExternalCall(this.logger, {
        service: 'r2',
        operation: 'presign-read',
        outcome: 'failure',
        attempts: 1,
        durationMs: Date.now() - startedAt,
        error: describeExternalError(error),
      });
      this.logger.warn(
        `B5 CP4a: failed to sign a read URL for ${key}: ${describeExternalError(error)}`,
      );
      return null;
    }
  }

  /**
   * B5 — CP4a: the uncached signing path — private and followers-visibility
   * posts (per the agreed design: no Redis caching for either, so a hide/
   * delete's revocation window stays as short as the TTL itself, never
   * extended by a cached, reused URL).
   *
   * `ownerUserId` is the CONTENT'S OWNER (post author / profile owner /
   * space creator), never the viewer — see extractUploadKey's own doc
   * comment. This does no authorization of its own: call it only for a row
   * a caller has ALREADY decided the current viewer may see (the SQL
   * visibility filter, or an admin guard, already ran) — see each call site.
   *
   * Returns the input unchanged when it isn't recognizably one of our own R2
   * uploads (extractUploadKey() returns null — not configured, or just not
   * one of ours, e.g. a space's externally-hosted cover image) — a safe
   * pass-through, never a thrown error over content this helper doesn't own.
   * Returns null only when `storedUrl` itself is null/undefined.
   */
  async toSignedReadUrl(
    storedUrl: string | null | undefined,
    ownerUserId: string,
    ttlSeconds: number,
  ): Promise<string | null> {
    if (!storedUrl) return null;
    const key = extractUploadKey(storedUrl, ownerUserId);
    if (key === null) return storedUrl;
    return this.signKey(key, ttlSeconds);
  }

  /**
   * B5 — CP4a: the cached signing path — profile photos, approved public
   * posts, and spaces ONLY (per the agreed design). Never call this for
   * private or followers-visibility content: the cached value is shared by
   * EVERY future caller for the same key regardless of who they are, which
   * is exactly right for genuinely public content (same bytes, same
   * audience, by definition) and exactly wrong for anything gated by viewer
   * identity — see toSignedReadUrl's own doc comment for the per-request,
   * uncached path those use instead.
   *
   * The cache stores the SIGNED URL, not just the key, with a TTL always
   * shorter than the signature's own (cachedReadTtlSeconds) — so whatever
   * Redis returns is guaranteed still valid; a cache miss (including Redis
   * being down — RedisCacheService fails open) just re-signs.
   */
  async toCachedSignedReadUrl(
    storedUrl: string | null | undefined,
    ownerUserId: string,
    ttlSeconds: number,
  ): Promise<string | null> {
    if (!storedUrl) return null;
    const key = extractUploadKey(storedUrl, ownerUserId);
    if (key === null) return storedUrl;

    const cacheKey = signedReadCacheKey(key);
    const cached = await this.cache.get<string>(cacheKey);
    if (cached) return cached;

    const signed = await this.signKey(key, ttlSeconds);
    if (signed) {
      await this.cache.set(cacheKey, signed, cachedReadTtlSeconds(ttlSeconds));
    }
    return signed;
  }

  /**
   * B5 — CP4a: invalidates the cached signed URL for a post's image — call
   * this at the exact moment a post is soft-deleted (WorkoutPostsService.
   * remove()) or hidden by an admin (WorkoutPostReportsService's `hide`
   * action), right alongside the DB write that makes it stop appearing in
   * every read path.
   *
   * This does NOT revoke a copy of the URL someone already has (impossible
   * with plain presigned URLs — see B5's design doc); it only stops Redis
   * from handing that same URL to anyone who asks AFTER this point. Combined
   * with the 1h public-post TTL, this is the agreed, accepted mitigation —
   * not a guarantee of instant revocation.
   */
  async invalidateCachedReadUrl(
    storedUrl: string | null | undefined,
    ownerUserId: string,
  ): Promise<void> {
    if (!storedUrl) return;
    const key = extractUploadKey(storedUrl, ownerUserId);
    if (key === null) return;
    await this.cache.del(signedReadCacheKey(key));
  }
}
