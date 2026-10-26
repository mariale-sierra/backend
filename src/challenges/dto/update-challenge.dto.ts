import { OmitType, PartialType } from '@nestjs/mapped-types';
import { CreateChallengeDto } from './create-challenge.dto';
import { ApiProperty } from '@nestjs/swagger';

// The challenge photo is only set at creation (there is no edit flow for it).
export class UpdateChallengeDto extends PartialType(
  OmitType(CreateChallengeDto, ['imageUrl'] as const),
) {}
