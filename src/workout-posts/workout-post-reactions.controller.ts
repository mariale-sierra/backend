import {
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import {
  ReactorDto,
  WorkoutPostReactionsService,
} from './workout-post-reactions.service';
import { CursorPaginationQueryDto } from '../common/cursor-pagination-query.dto';
import { decodeCursor, DEFAULT_PAGE_LIMIT } from '../common/pagination.util';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';

@ApiTags('Workout Post Reactions')
@ApiBearerAuth()
@Controller('workout-posts/:postId/reactions')
export class WorkoutPostReactionsController {
  constructor(private readonly reactionsService: WorkoutPostReactionsService) {}

  @Post()
  @ApiParam({ name: 'postId', description: 'ID (UUID) del workout post' })
  @ApiOperation({
    summary: 'Reaccionar a una publicación',
    description: 'El usuario autenticado reacciona (like) a :postId.',
  })
  @ApiOkResponse({ description: 'Reacción agregada' })
  @ApiNotFoundResponse({ description: 'Publicación no encontrada' })
  @ApiConflictResponse({ description: 'Ya reaccionaste a esta publicación' })
  react(
    @Param('postId', new ParseUUIDPipe()) postId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.reactionsService.react(postId, user.sub);
  }

  @Delete()
  @ApiParam({ name: 'postId', description: 'ID (UUID) del workout post' })
  @ApiOperation({
    summary: 'Quitar la reacción propia',
    description: 'El usuario autenticado quita su propia reacción de :postId.',
  })
  @ApiOkResponse({ description: 'Reacción eliminada' })
  @ApiNotFoundResponse({ description: 'No has reaccionado a esta publicación' })
  unreact(
    @Param('postId', new ParseUUIDPipe()) postId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.reactionsService.unreact(postId, user.sub);
  }

  @Get()
  @ApiParam({ name: 'postId', description: 'ID (UUID) del workout post' })
  @ApiOperation({
    summary: 'Estado de reacciones de una publicación',
    description:
      'Cantidad total de reacciones y si el usuario autenticado ya reaccionó.',
  })
  @ApiOkResponse({ description: '{ count, reactedByMe }' })
  @ApiNotFoundResponse({ description: 'Publicación no encontrada' })
  getSummary(
    @Param('postId', new ParseUUIDPipe()) postId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.reactionsService.getSummary(postId, user.sub);
  }

  @Get('users')
  @ApiParam({ name: 'postId', description: 'ID (UUID) del workout post' })
  @ApiOperation({
    summary: 'Quién reaccionó a una publicación',
    description:
      'Usuarios que reaccionaron a :postId, más recientes primero. Paginado con cursor (header X-Next-Cursor).',
  })
  @ApiHeader({
    name: 'X-Next-Cursor',
    required: false,
    description: 'Presente solo si existe una página siguiente',
  })
  @ApiOkResponse({ type: ReactorDto, isArray: true })
  @ApiNotFoundResponse({ description: 'Publicación no encontrada' })
  async listReactors(
    @Param('postId', new ParseUUIDPipe()) postId: string,
    @Query() query: CursorPaginationQueryDto,
    @Res({ passthrough: true }) res: Response,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const { reactors, nextCursor } = await this.reactionsService.listReactors(
      postId,
      user.sub,
      {
        limit: query.limit ?? DEFAULT_PAGE_LIMIT,
        cursor: query.cursor ? decodeCursor(query.cursor, 'uuid') : undefined,
      },
    );
    if (nextCursor) res.setHeader('X-Next-Cursor', nextCursor);
    return reactors;
  }
}
