import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min } from 'class-validator';

export class AddRoutineExerciseDto {
  @ApiProperty({ description: 'ID del ejercicio a añadir a la rutina', example: 1 })
  @IsInt()
  @Min(1)
  exerciseId!: number;
}
