import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  IsUrl,
  MaxLength,
} from 'class-validator';
import type { SpaceVisibility } from '../entities/space.entity';

/**
 * Same fields as CreateSpaceDto, all optional — the "Manage space" screen
 * (wireframe 47C) is the same form for create and edit, so this only needs
 * to allow a partial update, not redefine the shape.
 */
export class UpdateSpaceDto {
  @ApiPropertyOptional({ description: 'Nombre del space' })
  @IsOptional()
  @IsString()
  @MaxLength(150, { message: 'name must be at most 150 characters' })
  name?: string;

  @ApiPropertyOptional({ description: 'Descripción del space' })
  @IsOptional()
  @IsString()
  @MaxLength(1000, { message: 'description must be at most 1000 characters' })
  description?: string;

  @ApiPropertyOptional({ description: 'URL de la imagen del space' })
  @IsOptional()
  @IsUrl({}, { message: 'imageUrl must be a valid URL' })
  imageUrl?: string;

  @ApiPropertyOptional({
    description:
      'Público (ingreso instantáneo) o privado (requiere aprobación del owner)',
    enum: ['public', 'private'],
  })
  @IsOptional()
  @IsEnum(['public', 'private'], {
    message: 'visibility must be either public or private',
  })
  visibility?: SpaceVisibility;

  @ApiPropertyOptional({
    description: 'ID de la categoría de actividad (GET /exercises/categories)',
  })
  @IsOptional()
  @IsInt()
  @IsPositive()
  activityCategoryId?: number;
}
