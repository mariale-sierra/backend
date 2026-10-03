import { Injectable, InternalServerErrorException } from '@nestjs/common';
import {
  S3Client,
  PutObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class UploadsService {
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
    maxAttempts: 2,
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });

  async getPresignedUrl(fileType: string, userId: string) {
    const extension = fileType.split('/')[1];
    // Scope the object key with the owning user id so uploads are
    // attributable and one user can't overwrite/guess another's key.
    const key = `uploads/${userId}/${uuidv4()}.${extension}`;

    try {
      const command = new PutObjectCommand({
        Bucket: process.env['CLOUDFLARE_R2_BUCKET_NAME'],
        Key: key,
      });

      const signedUrl = await getSignedUrl(this.s3, command, {
        expiresIn: 300,
      });

      const publicUrl = `${process.env['CLOUDFLARE_R2_PUBLIC_URL']}/${key}`;

      return { signedUrl, publicUrl, key };
    } catch (error) {
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
      const page = await this.s3.send(
        new ListObjectsV2Command({ Bucket, Prefix, ContinuationToken }),
      );
      const keys = (page.Contents ?? []).flatMap((o) =>
        o.Key ? [{ Key: o.Key }] : [],
      );
      if (keys.length > 0) {
        const result = await this.s3.send(
          new DeleteObjectsCommand({
            Bucket,
            Delete: { Objects: keys, Quiet: true },
          }),
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
