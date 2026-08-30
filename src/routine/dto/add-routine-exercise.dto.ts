import { Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  Min,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AddRoutineExerciseTargetDto {
  @ApiProperty({
    description: 'ID del metric_type objetivo (ver GET /metrics)',
    example: 5,
  })
  @IsInt()
  @Min(1)
  metric_type_id!: number;

  @ApiProperty({ description: 'Valor objetivo', example: 30 })
  @IsNumber()
  value!: number;
}

export class AddRoutineExerciseSetDto {
  @ApiProperty({ description: 'Número de set (1-indexado)', example: 1 })
  @IsInt()
  @Min(1)
  set_number!: number;

  @ApiPropertyOptional({
    description:
      "Atajo para el target 'reps' de este set — equivalente a incluir {metric_type_id: <id de 'reps'>, value} en targets[].",
    example: 10,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  reps?: number;

  @ApiPropertyOptional({
    description: 'Segundos de descanso después de este set',
    example: 60,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  rest_seconds_after?: number;

  @ApiPropertyOptional({
    type: [AddRoutineExerciseTargetDto],
    description:
      "Targets adicionales para este set (ej. distancia/duración en un ejercicio de cardio), además del atajo 'reps' de arriba.",
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AddRoutineExerciseTargetDto)
  targets?: AddRoutineExerciseTargetDto[];
}

export class AddRoutineExerciseDto {
  @ApiProperty({
    description: 'ID del ejercicio a añadir a la rutina',
    example: 1,
  })
  @IsInt()
  @Min(1)
  exerciseId!: number;

  @ApiPropertyOptional({
    type: [AddRoutineExerciseSetDto],
    description: 'Sets del ejercicio (reps, descanso, targets por set)',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AddRoutineExerciseSetDto)
  sets?: AddRoutineExerciseSetDto[];

  @ApiPropertyOptional({
    type: [AddRoutineExerciseTargetDto],
    description:
      'Targets a nivel de ejercicio (no ligados a un set específico) — ej. duración/distancia de un ejercicio de cardio sin sets.',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AddRoutineExerciseTargetDto)
  targets?: AddRoutineExerciseTargetDto[];
}
