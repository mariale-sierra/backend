import {
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { WorkoutPostReactionsService } from './workout-post-reactions.service';
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
}
