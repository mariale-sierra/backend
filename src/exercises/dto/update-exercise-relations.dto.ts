import { Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  Min,
  ValidateNested,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class MuscleAssignmentDto {
  @IsInt()
  @Min(1)
  muscleId!: number;

  @IsIn(['primary', 'secondary'])
  role!: 'primary' | 'secondary';
}

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

  @ApiPropertyOptional({
    description:
      'Asignaciones de músculo del ejercicio (reemplaza todas las existentes si se envía)',
    type: [MuscleAssignmentDto],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MuscleAssignmentDto)
  muscleAssignments?: MuscleAssignmentDto[];
}
