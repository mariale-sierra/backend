import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { CursorPaginationQueryDto } from '../common/cursor-pagination-query.dto';
import { decodeCursor, DEFAULT_PAGE_LIMIT } from '../common/pagination.util';
import { NotificationsService } from './notifications.service';
import { PushTokensService } from './push-tokens.service';
import {
  MarkAllReadResultDto,
  NotificationDto,
  UnreadCountDto,
} from './dto/notification.dto';
import {
  NotificationPreferenceDto,
  UpdateNotificationPreferencesDto,
} from './dto/notification-preferences.dto';
import { RegisterPushTokenDto, RemovePushTokenDto } from './dto/push-token.dto';

@ApiTags('Notifications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly pushTokensService: PushTokensService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Bandeja de notificaciones del usuario autenticado',
    description:
      'Más recientes primero, paginada por cursor (keyset sobre created_at/id, mismo patrón que GET /challenges). El cursor de la página siguiente llega en el header X-Next-Cursor.',
  })
  @ApiHeader({
    name: 'X-Next-Cursor',
    required: false,
    description: 'Presente solo si existe una página siguiente',
  })
  @ApiOkResponse({ type: [NotificationDto] })
  @ApiBadRequestResponse({ description: 'Cursor inválido' })
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: CursorPaginationQueryDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<NotificationDto[]> {
    const cursor = query.cursor
      ? decodeCursor(query.cursor, 'integer')
      : undefined;
    const { notifications, nextCursor } = await this.notificationsService.list(
      user.sub,
      cursor,
      query.limit ?? DEFAULT_PAGE_LIMIT,
    );
    if (nextCursor) {
      res.setHeader('X-Next-Cursor', nextCursor);
    }
    return notifications;
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Cantidad de notificaciones no leídas' })
  @ApiOkResponse({ type: UnreadCountDto })
  unreadCount(@CurrentUser() user: AuthenticatedUser): Promise<UnreadCountDto> {
    return this.notificationsService.unreadCount(user.sub);
  }

  @Patch('read-all')
  @ApiOperation({ summary: 'Marcar todas mis notificaciones como leídas' })
  @ApiOkResponse({ type: MarkAllReadResultDto })
  markAllRead(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<MarkAllReadResultDto> {
    return this.notificationsService.markAllRead(user.sub);
  }

  @Patch(':id/read')
  @ApiParam({ name: 'id', description: 'Id (numérico) de la notificación' })
  @ApiOperation({
    summary: 'Marcar una notificación como leída',
    description: 'Solo notificaciones propias; una ajena responde 404.',
  })
  @ApiOkResponse({ description: 'Marcada como leída' })
  @ApiNotFoundResponse({ description: 'No existe o no es tuya' })
  @ApiBadRequestResponse({ description: 'Id no numérico' })
  markRead(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<{ message: string }> {
    return this.notificationsService.markRead(user.sub, id);
  }

  @Get('preferences')
  @ApiOperation({
    summary: 'Preferencias de notificación por categoría',
    description:
      'Sin configuración guardada todo está habilitado (comportamiento de la migración).',
  })
  @ApiOkResponse({ type: [NotificationPreferenceDto] })
  getPreferences(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<NotificationPreferenceDto[]> {
    return this.notificationsService.getPreferences(user.sub);
  }

  @Patch('preferences')
  @ApiOperation({
    summary: 'Habilitar/deshabilitar categorías (bandeja y/o push)',
  })
  @ApiOkResponse({ type: [NotificationPreferenceDto] })
  updatePreferences(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateNotificationPreferencesDto,
  ): Promise<NotificationPreferenceDto[]> {
    return this.notificationsService.updatePreferences(user.sub, dto);
  }

  @Post('push-tokens')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Registrar o refrescar el token push (Expo) de este dispositivo',
    description:
      'Idempotente. Si el token pertenecía a otra cuenta (otro login en el mismo teléfono) pasa a esta.',
  })
  @ApiOkResponse({ description: 'Token registrado' })
  registerPushToken(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RegisterPushTokenDto,
  ): Promise<{ message: string }> {
    return this.pushTokensService.register(user.sub, dto.token, dto.platform);
  }

  @Delete('push-tokens')
  @ApiOperation({
    summary: 'Eliminar el token push de este dispositivo (logout)',
    description: 'Solo borra tokens propios. Idempotente.',
  })
  @ApiOkResponse({ description: 'Token eliminado' })
  removePushToken(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RemovePushTokenDto,
  ): Promise<{ message: string }> {
    return this.pushTokensService.unregister(user.sub, dto.token);
  }
}
