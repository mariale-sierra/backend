import { IsEnum, IsInt, IsOptional, IsString } from 'class-validator';

export enum ChallengeVisibility {
  PUBLIC = 'public',
  PRIVATE = 'private',
}

export class CreateChallengeDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  instructions?: string;

  @IsEnum(ChallengeVisibility)
  visibility!: ChallengeVisibility;

  @IsInt()
  duration_days!: number;

  @IsOptional()
  @IsInt()
  cycle_length_days?: number;
}
