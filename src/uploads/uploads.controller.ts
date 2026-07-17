import { Controller, Post, Body } from '@nestjs/common';
import { UploadsService } from './uploads.service';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { SignUploadDto } from './dto/sign-upload.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';

@ApiTags('uploads')
@Controller('uploads')
export class UploadsController {
  constructor(private readonly uploadsService: UploadsService) {}

  @Post('sign')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Obtener URL firmada para subir un archivo',
    description:
      'Genera una URL presignada de escritura a R2, con la clave del objeto prefijada por el usuario autenticado. Solo acepta image/jpeg, image/png o image/webp.',
  })
  @ApiResponse({ status: 201, description: 'URL firmada generada exitosamente' })
  @ApiResponse({ status: 400, description: 'Tipo de archivo no permitido' })
  @ApiResponse({ status: 401, description: 'No autorizado' })
  async getSignedUrl(
    @Body() dto: SignUploadDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.uploadsService.getPresignedUrl(dto.fileType, user.sub);
  }
}
