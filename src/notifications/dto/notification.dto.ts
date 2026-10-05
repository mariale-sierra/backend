import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type {
  NotificationCategory,
  NotificationEntityType,
  NotificationTypeCode,
} from '../notification-catalog';

export class NotificationActorDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  username!: string;

  @ApiPropertyOptional({ nullable: true, type: String })
  displayName!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  profileImageUrl!: string | null;
}

export class NotificationEntityDto {
  @ApiProperty({
    description:
      'Recurso al que navega la notificación (workout_post, challenge, space, direct_conversation, challenge_invite, content_report, user)',
  })
  type!: NotificationEntityType;

  @ApiPropertyOptional({ nullable: true, type: String })
  id!: string | null;
}

export class NotificationDto {
  @ApiProperty({ description: 'BIGINT serializado como string' })
  id!: string;

  @ApiProperty({ description: 'Código estable del tipo (p. ej. post_comment)' })
  type!: NotificationTypeCode;

  @ApiProperty()
  category!: NotificationCategory;

  @ApiProperty()
  isRead!: boolean;

  @ApiProperty()
  createdAt!: Date;

  @ApiPropertyOptional({
    type: NotificationActorDto,
    nullable: true,
    description:
      'null para eventos del sistema o si la cuenta del actor fue eliminada o tiene eliminación pendiente',
  })
  actor!: NotificationActorDto | null;

  @ApiProperty({ type: NotificationEntityDto })
  entity!: NotificationEntityDto;

  @ApiProperty({
    description:
      'Ids extra para navegar (nunca contenido escrito por usuarios)',
    type: 'object',
    additionalProperties: { type: 'string' },
  })
  data!: Record<string, string>;

  @ApiPropertyOptional({
    nullable: true,
    type: String,
    description:
      'Texto genérico de respaldo; la app usa su propio texto i18n por `type`',
  })
  title!: string | null;

  @ApiPropertyOptional({ nullable: true, type: String })
  body!: string | null;
}

export class UnreadCountDto {
  @ApiProperty()
  count!: number;
}

export class MarkAllReadResultDto {
  @ApiProperty({ description: 'Notificaciones marcadas como leídas' })
  updated!: number;
}
