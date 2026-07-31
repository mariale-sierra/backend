import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ChallengeInvitesService } from './challenge-invites.service';
import { CreateChallengeInviteDto } from './dto/create-challenge-invite.dto';
import { ChallengeInviteResponseDto } from './dto/challenge-invite-response.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';

@ApiTags('Challenge Invites')
@ApiBearerAuth()
@Controller('challenge-invites')
export class ChallengeInvitesController {
  constructor(private readonly invitesService: ChallengeInvitesService) {}

  @Post()
  @ApiOperation({
    summary: 'Crear invitación',
    description:
      'Invita a otro usuario a un challenge. Solo el creador o un miembro activo pueden invitar. ' +
      'Rechaza autoinvitaciones, usuarios ya miembros y duplicados pendientes.',
  })
  @ApiCreatedResponse({
    description: 'Invitación creada',
    type: ChallengeInviteResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'Challenge o usuario destinatario no existen',
  })
  @ApiForbiddenResponse({
    description: 'El remitente no pertenece al challenge',
  })
  @ApiConflictResponse({
    description:
      'Ya existe una invitación pendiente o el usuario ya es miembro',
  })
  @ApiResponse({
    status: 400,
    description:
      'Datos inválidos (UUIDs, autoinvitación, longitud del mensaje)',
  })
  async create(
    @Body() dto: CreateChallengeInviteDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ChallengeInviteResponseDto> {
    const invite = await this.invitesService.create(
      user.sub,
      dto.challengeId,
      dto.recipientUserId,
      dto.message,
    );
    return ChallengeInviteResponseDto.fromEntity(invite);
  }

  @Get('received')
  @ApiOperation({
    summary: 'Invitaciones recibidas',
    description:
      'Lista todas las invitaciones recibidas por el usuario autenticado (todas los estados).',
  })
  @ApiOkResponse({ type: ChallengeInviteResponseDto, isArray: true })
  async listReceived(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ChallengeInviteResponseDto[]> {
    return ChallengeInviteResponseDto.fromEntities(
      await this.invitesService.listReceived(user.sub),
    );
  }

  @Get('sent')
  @ApiOperation({
    summary: 'Invitaciones enviadas',
    description:
      'Lista todas las invitaciones enviadas por el usuario autenticado (todos los estados).',
  })
  @ApiOkResponse({ type: ChallengeInviteResponseDto, isArray: true })
  async listSent(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ChallengeInviteResponseDto[]> {
    return ChallengeInviteResponseDto.fromEntities(
      await this.invitesService.listSent(user.sub),
    );
  }

  @Get('pending')
  @ApiOperation({
    summary: 'Invitaciones pendientes',
    description: 'Lista solo las invitaciones recibidas en estado pending.',
  })
  @ApiOkResponse({ type: ChallengeInviteResponseDto, isArray: true })
  async listPending(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ChallengeInviteResponseDto[]> {
    return ChallengeInviteResponseDto.fromEntities(
      await this.invitesService.listPendingReceived(user.sub),
    );
  }

  @Post(':id/accept')
  @ApiOperation({
    summary: 'Aceptar invitación',
    description:
      'Solo el destinatario puede aceptar y solo en estado pending. Une al usuario al challenge en la misma transacción.',
  })
  @ApiParam({ name: 'id', description: 'ID de la invitación' })
  @ApiOkResponse({
    description: 'Invitación aceptada',
    type: ChallengeInviteResponseDto,
  })
  @ApiNotFoundResponse({ description: 'Invitación no encontrada' })
  @ApiForbiddenResponse({ description: 'El usuario no es el destinatario' })
  @ApiConflictResponse({
    description: 'La invitación ya fue procesada o expiró',
  })
  async accept(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ChallengeInviteResponseDto> {
    return ChallengeInviteResponseDto.fromEntity(
      await this.invitesService.accept(id, user.sub),
    );
  }

  @Post(':id/decline')
  @ApiOperation({
    summary: 'Rechazar invitación',
    description:
      'Solo el destinatario puede rechazar y solo en estado pending.',
  })
  @ApiParam({ name: 'id', description: 'ID de la invitación' })
  @ApiOkResponse({
    description: 'Invitación rechazada',
    type: ChallengeInviteResponseDto,
  })
  @ApiNotFoundResponse({ description: 'Invitación no encontrada' })
  @ApiForbiddenResponse({ description: 'El usuario no es el destinatario' })
  @ApiConflictResponse({
    description: 'La invitación ya fue procesada o expiró',
  })
  async decline(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ChallengeInviteResponseDto> {
    return ChallengeInviteResponseDto.fromEntity(
      await this.invitesService.decline(id, user.sub),
    );
  }

  @Post(':id/cancel')
  @ApiOperation({
    summary: 'Cancelar invitación',
    description: 'Solo el remitente puede cancelar y solo en estado pending.',
  })
  @ApiParam({ name: 'id', description: 'ID de la invitación' })
  @ApiOkResponse({
    description: 'Invitación cancelada',
    type: ChallengeInviteResponseDto,
  })
  @ApiNotFoundResponse({ description: 'Invitación no encontrada' })
  @ApiForbiddenResponse({ description: 'El usuario no es el remitente' })
  @ApiConflictResponse({
    description: 'La invitación ya fue procesada o expiró',
  })
  async cancel(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ChallengeInviteResponseDto> {
    return ChallengeInviteResponseDto.fromEntity(
      await this.invitesService.cancel(id, user.sub),
    );
  }
}
