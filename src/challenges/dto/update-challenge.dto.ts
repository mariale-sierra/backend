import { PartialType } from '@nestjs/mapped-types';
import { CreateChallengeDto } from './create-challenge.dto';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateChallengeDto extends PartialType(CreateChallengeDto) {}
