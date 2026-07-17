import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateChallengeExerciseSetDto {
  @ApiProperty({ example: 1 })
  @IsInt()
  @Min(1)
  set_number!: number;

  @ApiProperty({ example: 10 })
  @IsInt()
  @Min(0)
  reps!: number;

  @ApiProperty({ example: 60 })
  @IsInt()
  @Min(0)
  rest_seconds!: number;
}

export class CreateChallengeExerciseMetricsDto {
  @ApiProperty({ enum: ['strength', 'schema'], example: 'strength' })
  @IsIn(['strength', 'schema'])
  kind!: 'strength' | 'schema';

  // strength
  @ApiPropertyOptional({ type: [CreateChallengeExerciseSetDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateChallengeExerciseSetDto)
  sets?: CreateChallengeExerciseSetDto[];

  // schema
  @ApiPropertyOptional({ example: 'mock-cardio-template' })
  @IsOptional()
  @IsString()
  template_id?: string;

  @ApiPropertyOptional({
    description:
      'Map of schema field key -> numeric value, or { minutes, seconds } for duration fields.',
    example: { distanceKm: 5, duration: { minutes: 20, seconds: 0 } },
  })
  @IsOptional()
  @IsObject()
  values?: Record<string, number | { minutes: number; seconds: number }>;
}

export class CreateChallengeExerciseDto {
  @ApiProperty({ example: 'Push ups' })
  @IsString()
  name!: string;

  @ApiProperty({ example: 'Gym' })
  @IsString()
  location!: string;

  @ApiProperty({ enum: ['strength', 'schema'], example: 'strength' })
  @IsIn(['strength', 'schema'])
  metric_type!: 'strength' | 'schema';

  @ApiProperty({
    enum: [
      'strength',
      'cardioIntense',
      'cardioLow',
      'flexibility',
      'mindBody',
      'functional',
    ],
    example: 'strength',
  })
  @IsIn([
    'strength',
    'cardioIntense',
    'cardioLow',
    'flexibility',
    'mindBody',
    'functional',
  ])
  activity_type!:
    | 'strength'
    | 'cardioIntense'
    | 'cardioLow'
    | 'flexibility'
    | 'mindBody'
    | 'functional';

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  muscle_groups?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  note?: string;

  @ApiProperty({ type: CreateChallengeExerciseMetricsDto })
  @ValidateNested()
  @Type(() => CreateChallengeExerciseMetricsDto)
  metrics!: CreateChallengeExerciseMetricsDto;
}
