import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { WorkoutPostsService } from './workout-posts.service';
import { CursorPaginationQueryDto } from './dto/cursor-pagination-query.dto';
import { decodeCursor, DEFAULT_PAGE_LIMIT } from './pagination.util';

@ApiTags('Feed')
@Controller('feed')
export class FeedController {
  constructor(private readonly workoutPostsService: WorkoutPostsService) {}

  @Get()
  @ApiBearerAuth()
  @ApiQuery({
    name: 'cursor',
    required: false,
    description:
      'Cursor opaco de la página anterior (header X-Next-Cursor de la respuesta previa). Omitir para la primera página.',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: `Máximo de resultados (default ${DEFAULT_PAGE_LIMIT}, máximo 50)`,
  })
  @ApiOperation({
    summary: 'Feed público de publicaciones',
    description:
      "Publicaciones con visibility='public' AND moderation_status='approved', ordenadas por created_at DESC, id DESC. Sin excepción para el propio autor: 'private', 'followers', 'pending' y 'rejected' nunca aparecen aquí. 'followers' no se resuelve en este feed público porque no hay contexto de viewer por publicación (es un único feed compartido); esa visibilidad sí se resuelve en GET /workout-posts/user/:userId usando el módulo de seguidores. Requiere autenticación (guard global).",
  })
  @ApiHeader({
    name: 'X-Next-Cursor',
    required: false,
    description: 'Presente solo si existe una página siguiente',
  })
  @ApiOkResponse({
    description:
      'Arreglo plano de publicaciones (FeedPostContract[]), sin envelope',
  })
  async getFeed(
    @Query() query: CursorPaginationQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const cursor = query.cursor ? decodeCursor(query.cursor) : undefined;

    const { posts, nextCursor } = await this.workoutPostsService.getFeed({
      limit,
      cursor,
    });

    if (nextCursor) {
      res.setHeader('X-Next-Cursor', nextCursor);
    }

    return posts;
  }
}
