import { ApiProperty } from '@nestjs/swagger';

export class MessageDto {
  @ApiProperty({ description: 'ID del mensaje' })
  id!: number;

  @ApiProperty({ description: 'ID (UUID) de la conversación' })
  conversationId!: string;

  @ApiProperty({ description: 'ID (UUID) del usuario que envió el mensaje' })
  senderId!: string;

  @ApiProperty({ description: 'Contenido del mensaje' })
  content!: string;

  @ApiProperty({ description: 'Fecha de envío' })
  sentAt!: Date;

  @ApiProperty({
    description:
      'Fecha en que el destinatario leyó el mensaje, o null si sigue sin leer',
    nullable: true,
  })
  readAt!: Date | null;
}
