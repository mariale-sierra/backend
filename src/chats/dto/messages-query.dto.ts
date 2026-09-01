import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export const DEFAULT_MESSAGES_LIMIT = 30;
export const MAX_MESSAGES_LIMIT = 50;

/**
 * Simple keyset pagination over direct_messages' own BIGINT identity id
 * (not the opaque base64 cursor from workout-posts' pagination.util — that
 * one exists specifically because workout_posts.id is a UUID; here the PK
 * is already a monotonically increasing integer, safe to expose directly).
 */
export class MessagesQueryDto {
  @ApiPropertyOptional({
    description:
      'Devuelve solo mensajes con id menor a este valor (para pedir mensajes más antiguos que la última página cargada). Omitir para pedir los más recientes.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  before?: number;

  @ApiPropertyOptional({
    description: `Cantidad máxima de mensajes por página. Default ${DEFAULT_MESSAGES_LIMIT}, máximo ${MAX_MESSAGES_LIMIT}.`,
    minimum: 1,
    maximum: MAX_MESSAGES_LIMIT,
    default: DEFAULT_MESSAGES_LIMIT,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_MESSAGES_LIMIT)
  limit?: number;
}
