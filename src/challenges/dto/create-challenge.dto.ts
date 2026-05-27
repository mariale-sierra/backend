import { IsArray, IsEnum, IsInt, IsOptional, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Min } from 'class-validator';

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
    description: 'Categorías del desafío',
    required: false,
    type: [Object],
  })
  @IsOptional()
  @IsArray()
  categories?: any[];

  @ApiProperty({
    description: 'Ubicaciones del desafío',
    required: false,
    type: [Object],
  })
  @IsOptional()
  @IsArray()
  locations?: any[];

  @ApiProperty({
    description: 'Días del ciclo del desafío',
    required: false,
    type: [Object],
  })
  @IsOptional()
  @IsArray()
  cycle_days?: any[];
}
