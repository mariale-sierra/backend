import { Controller, Post, Body } from '@nestjs/common';
import { UploadsService } from './uploads.service';
import { ApiTags } from '@nestjs/swagger';

@ApiTags('uploads')
@Controller('uploads')
export class UploadsController {
  constructor(private readonly uploadsService: UploadsService) {}

  @Post('sign')
  async getSignedUrl(@Body('fileType') fileType: string) {
    return this.uploadsService.getPresignedUrl(fileType);
  }
}