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
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';

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
    summary: 'Feed de publicaciones',
    description:
      "Publicaciones con moderation_status='approved', ordenadas por created_at DESC, id DESC. Visibilidad: visibility='public' aparece para cualquier usuario autenticado; visibility='followers' aparece solo para su propio autor y para viewers que sigan activamente a ese autor (mismo chequeo de user_follows que GET /workout-posts/user/:userId); visibility='private' nunca aparece aquí, ni siquiera para su propio autor (el feed no es la superficie para posts privados; para eso está el perfil). 'pending' y 'rejected' nunca aparecen. Requiere autenticación (guard global).",
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
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const cursor = query.cursor ? decodeCursor(query.cursor) : undefined;

    const { posts, nextCursor } = await this.workoutPostsService.getFeed({
      limit,
      cursor,
      viewerId: user.sub,
    });

    if (nextCursor) {
      res.setHeader('X-Next-Cursor', nextCursor);
    }

    return posts;
  }
}
