import { ApiProperty } from '@nestjs/swagger';
import { SpaceMessageSenderDto } from './space-message-sender.dto';

/**
 * Unlike chats' MessageDto (flat senderId — the "other" DM participant is
 * already known from context), this nests the full sender object: a space
 * is a GROUP thread, so the frontend needs each message's own avatar/name
 * to render it.
 */
export class SpaceMessageDto {
  @ApiProperty({ description: 'ID del mensaje' })
  id!: number;

  @ApiProperty({ description: 'ID (UUID) del space' })
  spaceId!: string;

  @ApiProperty({ type: SpaceMessageSenderDto })
  sender!: SpaceMessageSenderDto;

  @ApiProperty({ description: 'Contenido del mensaje' })
  content!: string;

  @ApiProperty({ description: 'Fecha de envío' })
  sentAt!: Date;
}
