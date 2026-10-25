import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsInt, Min } from 'class-validator';

export const ALLOWED_UPLOAD_FILE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

export type AllowedUploadFileType = (typeof ALLOWED_UPLOAD_FILE_TYPES)[number];

export class SignUploadDto {
  @ApiProperty({
    description: 'MIME type of the file to upload',
    enum: ALLOWED_UPLOAD_FILE_TYPES,
    example: 'image/jpeg',
  })
  @IsIn(ALLOWED_UPLOAD_FILE_TYPES)
  fileType!: AllowedUploadFileType;

  /**
   * Real size in bytes of the file the caller is about to PUT. Only sanity-checked here
   * (positive integer); the actual ceiling (UPLOAD_MAX_BYTES, see uploads.service.ts) is
   * applied in the service, not as a decorator argument, so it keeps reading the
   * configurable env var at request time instead of once at class-decoration time (the
   * same lazy-env pattern the rest of this module already uses for the R2 vars).
   */
  @ApiProperty({
    description: 'Real size in bytes of the file to upload',
    example: 204800,
  })
  @IsInt()
  @Min(1)
  fileSize!: number;
}
