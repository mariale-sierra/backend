import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { SpacesService } from './spaces.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { CreateSpaceDto } from './dto/create-space.dto';
import { UpdateSpaceDto } from './dto/update-space.dto';
import { SpaceResponseDto } from './dto/space-response.dto';
import { SpaceMemberResponseDto } from './dto/space-member-response.dto';
import { SpaceJoinRequestResponseDto } from './dto/space-join-request-response.dto';
import { JoinSpaceResultDto } from './dto/join-space-result.dto';

@ApiTags('Spaces')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('spaces')
export class SpacesController {
  constructor(private readonly spacesService: SpacesService) {}

  @Post()
  @ApiOperation({
    summary: 'Crear space',
    description:
      'Crea un space y agrega automáticamente al usuario autenticado como owner en space_members.',
  })
  @ApiCreatedResponse({ type: SpaceResponseDto })
  @ApiNotFoundResponse({
    description: 'La categoría de actividad indicada no existe',
  })
  create(
    @Body() dto: CreateSpaceDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<SpaceResponseDto> {
    return this.spacesService.create(user.sub, dto);
  }

  @Get()
  @ApiOperation({
    summary: 'Listar spaces',
    description:
      'Todos los spaces activos (públicos y privados), cada uno anotado con si el usuario autenticado es miembro, su rol, y si tiene una solicitud de ingreso pendiente.',
  })
  @ApiOkResponse({ type: SpaceResponseDto, isArray: true })
  findAll(@CurrentUser() user: AuthenticatedUser): Promise<SpaceResponseDto[]> {
    return this.spacesService.findAll(user.sub);
  }

  @Get(':id')
  @ApiParam({ name: 'id', description: 'ID (UUID) del space' })
  @ApiOperation({ summary: 'Obtener un space' })
  @ApiOkResponse({ type: SpaceResponseDto })
  @ApiNotFoundResponse({ description: 'Space no encontrado' })
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<SpaceResponseDto> {
    return this.spacesService.findOne(user.sub, id);
  }

  @Patch(':id')
  @ApiParam({ name: 'id', description: 'ID (UUID) del space' })
  @ApiOperation({
    summary: 'Editar space',
    description:
      'Solo el owner puede editar nombre, descripción, imagen, privacidad o categoría de actividad.',
  })
  @ApiOkResponse({ type: SpaceResponseDto })
  @ApiNotFoundResponse({
    description: 'Space o categoría de actividad no encontrados',
  })
  @ApiForbiddenResponse({ description: 'El usuario no es el owner del space' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSpaceDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<SpaceResponseDto> {
    return this.spacesService.update(user.sub, id, dto);
  }

  @Delete(':id')
  @ApiParam({ name: 'id', description: 'ID (UUID) del space' })
  @ApiOperation({
    summary: 'Eliminar space',
    description: 'Solo el owner puede eliminar (soft delete) el space.',
  })
  @ApiOkResponse({ description: 'Space eliminado' })
  @ApiNotFoundResponse({ description: 'Space no encontrado' })
  @ApiForbiddenResponse({ description: 'El usuario no es el owner del space' })
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.spacesService.remove(user.sub, id);
  }

  @Post(':id/join')
  @ApiParam({ name: 'id', description: 'ID (UUID) del space' })
  @ApiOperation({
    summary: 'Unirse o solicitar ingreso a un space',
    description:
      'Space público: ingreso instantáneo. Space privado: crea una solicitud pendiente de aprobación del owner.',
  })
  @ApiOkResponse({ type: JoinSpaceResultDto })
  @ApiNotFoundResponse({ description: 'Space no encontrado' })
  @ApiConflictResponse({
    description: 'Ya es miembro del space o ya tiene una solicitud pendiente',
  })
  join(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<JoinSpaceResultDto> {
    return this.spacesService.join(user.sub, id);
  }

  @Delete(':id/leave')
  @ApiParam({ name: 'id', description: 'ID (UUID) del space' })
  @ApiOperation({
    summary: 'Salir de un space',
    description:
      'El owner no puede salir — debe eliminar el space en su lugar.',
  })
  @ApiOkResponse({ description: 'Salió del space' })
  @ApiNotFoundResponse({ description: 'No es miembro de este space' })
  @ApiConflictResponse({ description: 'El owner no puede salir del space' })
  leave(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.spacesService.leave(user.sub, id);
  }

  @Get(':id/members')
  @ApiParam({ name: 'id', description: 'ID (UUID) del space' })
  @ApiOperation({ summary: 'Listar participantes de un space' })
  @ApiOkResponse({ type: SpaceMemberResponseDto, isArray: true })
  @ApiNotFoundResponse({ description: 'Space no encontrado' })
  listMembers(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<SpaceMemberResponseDto[]> {
    return this.spacesService.listMembers(id);
  }

  @Get(':id/join-requests')
  @ApiParam({ name: 'id', description: 'ID (UUID) del space' })
  @ApiOperation({
    summary: 'Listar solicitudes de ingreso pendientes',
    description:
      'Solo el owner puede ver las solicitudes pendientes de su space.',
  })
  @ApiOkResponse({ type: SpaceJoinRequestResponseDto, isArray: true })
  @ApiNotFoundResponse({ description: 'Space no encontrado' })
  @ApiForbiddenResponse({ description: 'El usuario no es el owner del space' })
  listJoinRequests(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<SpaceJoinRequestResponseDto[]> {
    return this.spacesService.listJoinRequests(user.sub, id);
  }

  @Post(':id/join-requests/:requestId/approve')
  @ApiParam({ name: 'id', description: 'ID (UUID) del space' })
  @ApiParam({ name: 'requestId', description: 'ID de la solicitud' })
  @ApiOperation({ summary: 'Aprobar una solicitud de ingreso' })
  @ApiOkResponse({ type: SpaceJoinRequestResponseDto })
  @ApiNotFoundResponse({ description: 'Space o solicitud no encontrados' })
  @ApiForbiddenResponse({ description: 'El usuario no es el owner del space' })
  @ApiConflictResponse({ description: 'La solicitud ya fue procesada' })
  approveJoinRequest(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('requestId') requestId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<SpaceJoinRequestResponseDto> {
    return this.spacesService.respondToJoinRequest(
      user.sub,
      id,
      requestId,
      true,
    );
  }

  @Post(':id/join-requests/:requestId/reject')
  @ApiParam({ name: 'id', description: 'ID (UUID) del space' })
  @ApiParam({ name: 'requestId', description: 'ID de la solicitud' })
  @ApiOperation({ summary: 'Rechazar una solicitud de ingreso' })
  @ApiOkResponse({ type: SpaceJoinRequestResponseDto })
  @ApiNotFoundResponse({ description: 'Space o solicitud no encontrados' })
  @ApiForbiddenResponse({ description: 'El usuario no es el owner del space' })
  @ApiConflictResponse({ description: 'La solicitud ya fue procesada' })
  rejectJoinRequest(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('requestId') requestId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<SpaceJoinRequestResponseDto> {
    return this.spacesService.respondToJoinRequest(
      user.sub,
      id,
      requestId,
      false,
    );
  }
}
