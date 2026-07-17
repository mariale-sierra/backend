import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
} from 'class-validator';
import { TrackingMode } from '../entities/exercise.entity';

export class CreateExerciseDto {
  @ApiProperty({ description: 'Nombre del ejercicio', example: 'Sentadilla' })
  @IsString()
  name!: string;

  @ApiProperty({
    description: 'Slug único del ejercicio',
    example: 'sentadilla',
  })
  @IsString()
  slug!: string;

  @ApiProperty({
    description: 'Descripción del ejercicio',
    example: 'Ejercicio compuesto para tren inferior',
  })
  @IsString()
  description!: string;

  @ApiProperty({
    description: 'Instrucciones para ejecutar el ejercicio',
    example: 'Baja controladamente hasta 90 grados y sube',
  })
  @IsString()
  instructions!: string;

  @ApiPropertyOptional({
    description: 'URL del ícono del ejercicio',
    example: 'https://cdn.havit.app/icons/squat.png',
  })
  @IsOptional()
  @IsString()
  icon_url?: string;

  @ApiProperty({
    description: 'Modo de tracking del ejercicio',
    enum: TrackingMode,
    example: TrackingMode.SETS,
  })
  @IsEnum(TrackingMode)
  tracking_mode!: TrackingMode;

  @ApiPropertyOptional({
    description: 'Si el ejercicio está activo (visible en el catálogo)',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}
