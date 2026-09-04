import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/** Same comma-separated-query-param convention as CountExercisesQueryDto's
 * splitCommaList — `?category=strength,functional` rather than a JSON array,
 * matching every other list-shaped filter in this API. */
function splitCommaList(value: unknown): string[] {
  if (Array.isArray(value)) return value as string[];
  if (typeof value !== 'string' || value.trim() === '') return [];
  return value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

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
    description:
      'Código(s) de categoría, separados por coma (ej. strength,functional)',
    example: 'strength',
  })
  @IsOptional()
  @Transform(({ value }) => splitCommaList(value))
  @IsArray()
  @IsString({ each: true })
  category?: string[];

  @ApiPropertyOptional({
    description: 'Código(s) de location, separados por coma (ej. gym,home)',
    example: 'gym',
  })
  @IsOptional()
  @Transform(({ value }) => splitCommaList(value))
  @IsArray()
  @IsString({ each: true })
  location?: string[];

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
