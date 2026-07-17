import { IsArray, IsEnum, IsInt, IsOptional, IsString, ValidateNested } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Min } from 'class-validator';
import { Type } from 'class-transformer';
import { CreateChallengeCycleDayDto } from './create-challenge-cycle-day.dto';

export enum ChallengeVisibility {
  PUBLIC = 'public',
  PRIVATE = 'private',
}

export class CreateChallengeDto {
  @ApiProperty({
    description: 'Nombre del desafío',
    example: 'Reto de 30 días',
  })
  @IsString()
  name!: string;

  @ApiProperty({
    description: 'Descripción del desafío',
    example: 'Un desafío para mejorar tu resistencia cardiovascular',
    required: false,
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({
    description: 'Instrucciones del desafío',
    example: 'Realiza 30 minutos de cardio cada día',
    required: false,
  })
  @IsOptional()
  @IsString()
  instructions?: string;

  @ApiProperty({
    description: 'Visibilidad del desafío',
    enum: ChallengeVisibility,
    example: ChallengeVisibility.PUBLIC,
  })
  @IsEnum(ChallengeVisibility)
  visibility!: ChallengeVisibility;

  @ApiProperty({
    description: 'Duración del desafío en días',
    example: 30,
  })
  @IsInt()
  duration_days!: number;

  @ApiProperty({
    description: 'Longitud del ciclo en días',
    example: 7,
  })
  @IsInt()
  @Min(1)
  cycle_length_days!: number;

  @ApiProperty({
    description: 'Categorías del desafío (nombres, ej. "Strength")',
    required: false,
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  categories?: string[];

  @ApiProperty({
    description: 'Ubicaciones del desafío (nombres, ej. "Gym")',
    required: false,
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  locations?: string[];

  @ApiProperty({
    description:
      'Días del ciclo del desafío, con la rutina/ejercicios de cada día (workout) o vacío para días de descanso',
    required: false,
    type: [CreateChallengeCycleDayDto],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateChallengeCycleDayDto)
  cycle_days?: CreateChallengeCycleDayDto[];
}
