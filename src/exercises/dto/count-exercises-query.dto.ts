import { Transform } from 'class-transformer';
import { IsArray, IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/** Splits a comma-separated query string into a trimmed, non-empty string[].
 * Query params arrive as plain strings — `?categories=Strength,Cardio Intense`
 * — rather than a JSON array, same convention as the rest of this API's
 * query-string filters. */
function splitCommaList(value: unknown): string[] {
  if (Array.isArray(value)) return value as string[];
  if (typeof value !== 'string' || value.trim() === '') return [];
  return value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

export class CountExercisesQueryDto {
  @ApiPropertyOptional({
    description:
      'Nombres de categorías separados por coma (ver GET /exercises/categories)',
    example: 'Strength,Cardio Intense',
  })
  @IsOptional()
  @Transform(({ value }) => splitCommaList(value))
  @IsArray()
  @IsString({ each: true })
  categories?: string[];

  @ApiPropertyOptional({
    description: 'Nombres de ubicaciones separados por coma',
    example: 'Gym,Outdoor',
  })
  @IsOptional()
  @Transform(({ value }) => splitCommaList(value))
  @IsArray()
  @IsString({ each: true })
  locations?: string[];
}
