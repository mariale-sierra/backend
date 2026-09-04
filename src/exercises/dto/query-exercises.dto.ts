import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class QueryExercisesDto {
  @ApiPropertyOptional({
    description: 'Página (1-based)',
    example: 1,
    default: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({
    description: 'Tamaño de página',
    example: 20,
    default: 20,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageSize: number = 20;

  @ApiPropertyOptional({
    description:
      'Busca en el nombre en TODOS los locales guardados (no solo el activo), vía exercise_translations',
    example: 'squat',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    description: 'Código de categoría',
    example: 'strength',
  })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({ description: 'Código de location', example: 'gym' })
  @IsOptional()
  @IsString()
  location?: string;

  @ApiPropertyOptional({
    description: 'Código de región muscular',
    example: 'chest',
  })
  @IsOptional()
  @IsString()
  region?: string;

  @ApiPropertyOptional({
    description: 'Código de músculo',
    example: 'biceps_brachii',
  })
  @IsOptional()
  @IsString()
  muscle?: string;

  @ApiPropertyOptional({
    description: 'Locale para el texto traducido',
    example: 'es',
    default: 'en',
  })
  @IsOptional()
  @IsIn(['en', 'es'])
  locale: string = 'en';
}
