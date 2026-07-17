import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';

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
}
