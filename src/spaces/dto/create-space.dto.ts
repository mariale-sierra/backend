import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
  IsUrl,
  MaxLength,
} from 'class-validator';
import type { SpaceVisibility } from '../entities/space.entity';

export class CreateSpaceDto {
  @ApiProperty({
    description: 'Nombre del space',
    example: 'Girls running club',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(150, { message: 'name must be at most 150 characters' })
  name!: string;

  @ApiPropertyOptional({
    description: 'Descripción del space',
    example: 'Sunrise 5Ks and slow jogs, every weekend rain or not.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000, { message: 'description must be at most 1000 characters' })
  description?: string;

  @ApiPropertyOptional({ description: 'URL de la imagen del space' })
  @IsOptional()
  @IsUrl({}, { message: 'imageUrl must be a valid URL' })
  imageUrl?: string;

  @ApiProperty({
    description:
      'Público (ingreso instantáneo) o privado (requiere aprobación del owner)',
    enum: ['public', 'private'],
  })
  @IsEnum(['public', 'private'], {
    message: 'visibility must be either public or private',
  })
  visibility!: SpaceVisibility;

  @ApiPropertyOptional({
    description:
      'ID de la categoría de actividad (GET /exercises/categories) que define el color del space',
    example: 3,
  })
  @IsOptional()
  @IsInt()
  @IsPositive()
  activityCategoryId?: number;
}
