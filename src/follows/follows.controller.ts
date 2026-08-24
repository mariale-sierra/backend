import {
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { FollowsService } from './follows.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { FollowUserSummaryDto } from './dto/follow-user-summary.dto';
import { FriendStreakDto } from './dto/friend-streak.dto';

@ApiTags('Follows')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('follows')
export class FollowsController {
  constructor(private readonly followsService: FollowsService) {}

  @Post(':userId')
  @ApiParam({ name: 'userId', description: 'ID (UUID) del usuario a seguir' })
  @ApiOperation({
    summary: 'Seguir a un usuario',
    description:
      'El usuario autenticado empieza a seguir a :userId. Reactiva la relación si existía un follow inactivo.',
  })
  @ApiOkResponse({ description: 'Ahora sigues a este usuario' })
  @ApiBadRequestResponse({ description: 'No puedes seguirte a ti mismo' })
  @ApiNotFoundResponse({ description: 'Usuario a seguir no encontrado' })
  @ApiConflictResponse({ description: 'Ya sigues a este usuario' })
  follow(
    @Param('userId', ParseUUIDPipe) userId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.followsService.follow(user.sub, userId);
  }

  @Delete(':userId')
  @ApiParam({
    name: 'userId',
    description: 'ID (UUID) del usuario a dejar de seguir',
  })
  @ApiOperation({
    summary: 'Dejar de seguir a un usuario',
    description:
      'El usuario autenticado deja de seguir a :userId (soft delete vía is_active).',
  })
  @ApiOkResponse({ description: 'Dejaste de seguir a este usuario' })
  @ApiNotFoundResponse({ description: 'No sigues a este usuario' })
  unfollow(
    @Param('userId', ParseUUIDPipe) userId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.followsService.unfollow(user.sub, userId);
  }

  @Get('followers')
  @ApiOperation({
    summary: 'Mis seguidores',
    description:
      'Lista los usuarios que siguen activamente al usuario autenticado.',
  })
  @ApiOkResponse({ type: FollowUserSummaryDto, isArray: true })
  getFollowers(@CurrentUser() user: AuthenticatedUser) {
    return this.followsService.listFollowers(user.sub);
  }

  @Get('following')
  @ApiOperation({
    summary: 'A quién sigo',
    description:
      'Lista los usuarios que el usuario autenticado sigue activamente.',
  })
  @ApiOkResponse({ type: FollowUserSummaryDto, isArray: true })
  getFollowing(@CurrentUser() user: AuthenticatedUser) {
    return this.followsService.listFollowing(user.sub);
  }

  @Get('following/streaks')
  @ApiOperation({
    summary: 'Rachas de los usuarios que sigo',
    description:
      'Para cada usuario que el usuario autenticado sigue activamente, devuelve su racha actual (mismo cálculo/divisor que en todo el resto de la app) y si ya registró progreso hoy — para la fila de rachas de amigos en Home.',
  })
  @ApiOkResponse({ type: FriendStreakDto, isArray: true })
  getFollowingStreaks(@CurrentUser() user: AuthenticatedUser) {
    return this.followsService.getFriendStreaks(user.sub);
  }
}
