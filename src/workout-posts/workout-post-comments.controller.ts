import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { WorkoutPostCommentsService } from './workout-post-comments.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { CreateCommentDto } from './dto/create-comment.dto';
import { CommentsQueryDto } from './dto/comments-query.dto';

@ApiTags('Workout Post Comments')
@ApiBearerAuth()
@Controller('workout-posts/:postId/comments')
export class WorkoutPostCommentsController {
  constructor(private readonly commentsService: WorkoutPostCommentsService) {}

  @Post()
  @ApiParam({ name: 'postId', description: 'ID (UUID) del workout post' })
  @ApiOperation({
    summary: 'Comentar una publicación',
    description: 'El usuario autenticado agrega un comentario a :postId.',
  })
  @ApiOkResponse({ description: 'Comentario creado' })
  @ApiNotFoundResponse({ description: 'Publicación no encontrada' })
  create(
    @Param('postId', new ParseUUIDPipe()) postId: string,
    @Body() dto: CreateCommentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.commentsService.create(postId, user.sub, dto.content);
  }

  @Get()
  @ApiParam({ name: 'postId', description: 'ID (UUID) del workout post' })
  @ApiOperation({
    summary: 'Listar comentarios de una publicación',
    description:
      'Comentarios de :postId, más antiguos primero, paginados por id (keyset).',
  })
  @ApiOkResponse({ description: '{ comments, nextAfter }' })
  @ApiNotFoundResponse({ description: 'Publicación no encontrada' })
  list(
    @Param('postId', new ParseUUIDPipe()) postId: string,
    @Query() query: CommentsQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.commentsService.list(postId, user.sub, {
      after: query.after,
      limit: query.limit,
    });
  }

  @Delete(':commentId')
  @ApiParam({ name: 'postId', description: 'ID (UUID) del workout post' })
  @ApiParam({ name: 'commentId', description: 'ID del comentario' })
  @ApiOperation({
    summary: 'Eliminar un comentario propio',
    description: 'El usuario autenticado elimina su propio comentario.',
  })
  @ApiOkResponse({ description: 'Comentario eliminado' })
  @ApiNotFoundResponse({ description: 'Comentario no encontrado' })
  @ApiForbiddenResponse({ description: 'No es tu comentario' })
  remove(
    @Param('postId', new ParseUUIDPipe()) postId: string,
    @Param('commentId', new ParseIntPipe()) commentId: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.commentsService.remove(postId, commentId, user.sub);
  }
}
