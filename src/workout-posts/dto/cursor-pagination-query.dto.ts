import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT } from '../pagination.util';

// Real cursors (base64url of {c: ISO-8601 date, i: post id}) land well under
// 200 chars even for a long id; this just bounds how much an arbitrary
// client-supplied string gets base64-decoded/JSON-parsed per request.
const MAX_CURSOR_LENGTH = 500;

export class CursorPaginationQueryDto {
  @ApiPropertyOptional({
    description:
      'Cursor opaco de la página anterior (valor recibido en el header X-Next-Cursor de la respuesta anterior). Omitir para pedir la primera página.',
    example: 'eyJjIjoiMjAyNi0wOC0xNlQxMjowMDowMC4wMDBaIiwiaSI6IjQyIn0',
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAX_CURSOR_LENGTH)
  cursor?: string;

  @ApiPropertyOptional({
    description: `Cantidad máxima de resultados por página. Default ${DEFAULT_PAGE_LIMIT}, máximo ${MAX_PAGE_LIMIT}.`,
    minimum: 1,
    maximum: MAX_PAGE_LIMIT,
    default: DEFAULT_PAGE_LIMIT,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_LIMIT)
  limit?: number;
}
