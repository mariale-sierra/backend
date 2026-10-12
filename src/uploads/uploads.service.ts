import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import {
  S3Client,
  PutObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { v4 as uuidv4 } from 'uuid';
import {
  describeExternalError,
  recordExternalCall,
} from '../common/external-call-telemetry';

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

  constructor() {
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

  async getPresignedUrl(fileType: string, userId: string) {
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
      });

      const signedUrl = await getSignedUrl(this.s3, command, {
        expiresIn: 300,
      });

      const publicUrl = `${process.env['CLOUDFLARE_R2_PUBLIC_URL']}/${key}`;

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
}
