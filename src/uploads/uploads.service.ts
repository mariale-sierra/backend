import { Injectable } from '@nestjs/common';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
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
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });

  async getPresignedUrl(fileType: string) {
    const extension = fileType.split('/')[1];
    const key = `uploads/${uuidv4()}.${extension}`;

    const command = new PutObjectCommand({
      Bucket: process.env['CLOUDFLARE_R2_BUCKET_NAME'] as string,
      Key: key,
      ContentType: fileType,
    });

    const signedUrl = await getSignedUrl(this.s3, command, {
      expiresIn: 300,
      unhoistableHeaders: new Set(['x-amz-checksum-crc32', 'x-amz-sdk-checksum-algorithm']),
    });

    const publicUrl = `${process.env['CLOUDFLARE_R2_PUBLIC_URL']}/${key}`;

    return { signedUrl, publicUrl, key };
  }
}