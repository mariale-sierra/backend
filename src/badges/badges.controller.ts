import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { BadgesService } from './badges.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { BadgeDto } from './dto/badge.dto';

@ApiTags('Badges')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('badges')
export class BadgesController {
  constructor(private readonly badgesService: BadgesService) {}

  @Get('me')
  @ApiOperation({
    summary: 'Mis badges',
    description:
      'Badges calculados al vuelo a partir de entrenamientos, racha y desafíos completados (no persistidos en base de datos).',
  })
  @ApiOkResponse({ type: BadgeDto, isArray: true })
  getMyBadges(@CurrentUser() user: AuthenticatedUser) {
    return this.badgesService.getMyBadges(user.sub);
  }

  @Get('user/:userId')
  @ApiParam({ name: 'userId', description: 'ID (UUID) del usuario' })
  @ApiOperation({
    summary: 'Badges de otro usuario',
    description:
      'Respeta la privacidad del perfil: si es privado, solo el dueño o un seguidor activo ven la lista real; cualquier otro usuario recibe una lista vacía.',
  })
  @ApiOkResponse({ type: BadgeDto, isArray: true })
  @ApiNotFoundResponse({ description: 'Usuario no encontrado o inactivo' })
  getUserBadges(
    @Param('userId', ParseUUIDPipe) userId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.badgesService.getUserBadges(userId, user.sub);
  }
}
