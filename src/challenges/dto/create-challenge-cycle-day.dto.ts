import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CreateChallengeExerciseDto } from './create-challenge-exercise.dto';

export class CreateChallengeCycleDayDto {
  @ApiProperty({ example: 1 })
  @IsInt()
  @Min(1)
  day_number!: number;

  @ApiProperty({ example: false })
  @IsBoolean()
  is_rest_day!: boolean;

  @ApiPropertyOptional({ example: 'Upper body strength' })
  @IsOptional()
  @IsString()
  routine_name?: string;

  @ApiPropertyOptional({ example: 'Push/pull focused session' })
  @IsOptional()
  @IsString()
  routine_description?: string;

  @ApiPropertyOptional({ type: [CreateChallengeExerciseDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateChallengeExerciseDto)
  exercises?: CreateChallengeExerciseDto[];
}
