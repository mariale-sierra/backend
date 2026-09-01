import { ApiProperty } from '@nestjs/swagger';
import { ConversationParticipantDto } from './conversation-participant.dto';

export class LastMessagePreviewDto {
  @ApiProperty({ description: 'ID del mensaje' })
  id!: number;

  @ApiProperty({ description: 'Contenido del mensaje' })
  content!: string;

  @ApiProperty({ description: 'ID (UUID) de quien lo envió' })
  senderId!: string;

  @ApiProperty({ description: 'Fecha de envío' })
  sentAt!: Date;
}

export class ConversationSummaryDto {
  @ApiProperty({ description: 'ID (UUID) de la conversación' })
  id!: string;

  @ApiProperty({ description: 'Fecha de creación de la conversación' })
  createdAt!: Date;

  @ApiProperty({ type: ConversationParticipantDto })
  otherParticipant!: ConversationParticipantDto;

  @ApiProperty({
    type: LastMessagePreviewDto,
    nullable: true,
    description:
      'Último mensaje enviado, o null si la conversación todavía no tiene mensajes',
  })
  lastMessage!: LastMessagePreviewDto | null;

  @ApiProperty({
    description:
      'Cantidad de mensajes del otro participante que el usuario autenticado todavía no ha leído',
  })
  unreadCount!: number;
}
