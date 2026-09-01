import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsUUID } from 'class-validator';

export class CreateConversationDto {
  @ApiProperty({
    description:
      'ID (UUID) del usuario con quien iniciar (o reabrir) una conversación 1:1',
    example: '3f2b1c0d-9e8f-4a7b-b6c5-d4e3f2a1b0c9',
  })
  @IsUUID('4', { message: 'recipientUserId must be a valid UUID' })
  @IsNotEmpty()
  recipientUserId!: string;
}
