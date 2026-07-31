import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class CreateChallengeInviteDto {
  @ApiProperty({
    description: 'ID (UUID) del challenge al que se invita',
    example: 'b7c9a9a2-3f4e-4b2a-9c1d-2e8f0a1b2c3d',
  })
  @IsUUID('4', { message: 'challengeId must be a valid UUID' })
  @IsNotEmpty()
  challengeId!: string;

  @ApiProperty({
    description: 'ID (UUID) del usuario que recibirá la invitación',
    example: '3f2b1c0d-9e8f-4a7b-b6c5-d4e3f2a1b0c9',
  })
  @IsUUID('4', { message: 'recipientUserId must be a valid UUID' })
  @IsNotEmpty()
  recipientUserId!: string;

  @ApiPropertyOptional({
    description: 'Mensaje opcional para el destinatario',
    example: 'Join my 30-day challenge!',
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500, { message: 'message must be at most 500 characters' })
  message?: string;
}
