import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export const DEFAULT_COMMENTS_LIMIT = 20;
export const MAX_COMMENTS_LIMIT = 50;

/**
 * Keyset pagination over workout_post_comments' own BIGINT identity id —
 * same convention as spaces/dto/space-messages-query.dto.ts, but ascending
 * (oldest first) since comments read top-to-bottom rather than newest-first.
 */
export class CommentsQueryDto {
  @ApiPropertyOptional({
    description:
      'Devuelve solo comentarios con id mayor a este valor (para pedir la siguiente página de comentarios más recientes). Omitir para pedir la primera página.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  after?: number;

  @ApiPropertyOptional({
    description: `Cantidad máxima de comentarios por página. Default ${DEFAULT_COMMENTS_LIMIT}, máximo ${MAX_COMMENTS_LIMIT}.`,
    minimum: 1,
    maximum: MAX_COMMENTS_LIMIT,
    default: DEFAULT_COMMENTS_LIMIT,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_COMMENTS_LIMIT)
  limit?: number;
}
