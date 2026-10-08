import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
} from 'class-validator';

const MAX_MESSAGE_LENGTH = 2000;

/**
 * A message is text, shared content (a workout post OR a challenge — Sprint
 * 10, B5), or shared content plus a comment. `content` may only be omitted
 * when something is being shared; when present it's always validated.
 * Sharing a post and a challenge in the same message is rejected by
 * ChatsService.sendMessage.
 */
export class SendMessageDto {
  @ApiProperty({
    description:
      'Contenido del mensaje. Se puede omitir solo si se comparte un workoutPostId o un challengeId.',
    example: '¡Nos vemos en el reto mañana!',
    maxLength: MAX_MESSAGE_LENGTH,
    required: false,
  })
  @ValidateIf(
    (dto: SendMessageDto) =>
      dto.content !== undefined || (!dto.workoutPostId && !dto.challengeId),
  )
  @IsString()
  @IsNotEmpty({ message: 'content cannot be empty' })
  @MaxLength(MAX_MESSAGE_LENGTH, {
    message: `content must be at most ${MAX_MESSAGE_LENGTH} characters`,
  })
  content?: string;

  @ApiPropertyOptional({
    description: 'ID (UUID) de la publicación que se comparte en el mensaje',
  })
  @IsOptional()
  @IsUUID()
  workoutPostId?: string;

  @ApiPropertyOptional({
    description: 'ID (UUID) del challenge que se comparte en el mensaje',
  })
  @IsOptional()
  @IsUUID()
  challengeId?: string;
}
