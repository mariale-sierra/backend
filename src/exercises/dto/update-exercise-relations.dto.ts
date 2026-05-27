import { Type } from 'class-transformer';
import { ArrayUnique, IsArray, IsInt, IsOptional, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateExerciseRelationsDto {
  @ApiPropertyOptional({
    description: 'IDs de categorías del ejercicio',
    example: [1, 2],
    type: [Number],
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  categoryIds?: number[];

  @ApiPropertyOptional({
    description: 'ID de la categoría principal del ejercicio',
    example: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  primaryCategoryId?: number;

  @ApiPropertyOptional({
    description: 'IDs de locations del ejercicio',
    example: [1],
    type: [Number],
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  locationIds?: number[];

  @ApiPropertyOptional({
    description: 'ID de la location principal del ejercicio',
    example: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  primaryLocationId?: number;

  @ApiPropertyOptional({
    description: 'IDs de body parts del ejercicio',
    example: [3, 4],
    type: [Number],
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  bodyPartIds?: number[];
}
