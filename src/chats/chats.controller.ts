import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBadRequestResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { ChatsService } from './chats.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { MessagesQueryDto } from './dto/messages-query.dto';
import { ConversationSummaryDto } from './dto/conversation-summary.dto';
import { MessageDto } from './dto/message.dto';

@ApiTags('Chats')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('chats/conversations')
export class ChatsController {
  constructor(private readonly chatsService: ChatsService) {}

  @Post()
  @ApiOperation({
    summary: 'Iniciar (o reabrir) una conversación 1:1',
    description:
      'Si ya existe una conversación entre el usuario autenticado y recipientUserId, la devuelve en vez de crear una duplicada.',
  })
  @ApiOkResponse({ type: ConversationSummaryDto })
  @ApiBadRequestResponse({
    description: 'No puedes iniciar una conversación contigo mismo',
  })
  @ApiNotFoundResponse({ description: 'Usuario destinatario no encontrado' })
  createConversation(
    @Body() dto: CreateConversationDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.chatsService.findOrCreateDirectConversation(
      user.sub,
      dto.recipientUserId,
    );
  }

  @Get()
  @ApiOperation({
    summary: 'Listar mis conversaciones',
    description:
      'Conversaciones del usuario autenticado, ordenadas por actividad más reciente primero, con el otro participante, el último mensaje y el conteo de no leídos.',
  })
  @ApiOkResponse({ type: ConversationSummaryDto, isArray: true })
  listConversations(@CurrentUser() user: AuthenticatedUser) {
    return this.chatsService.listConversations(user.sub);
  }

  @Get(':id/messages')
  @ApiParam({ name: 'id', description: 'ID (UUID) de la conversación' })
  @ApiOperation({
    summary: 'Listar mensajes de una conversación',
    description:
      'Orden cronológico (más antiguo primero). Usar el `nextBefore` de la respuesta como `before` para pedir mensajes anteriores.',
  })
  @ApiOkResponse({ type: MessageDto, isArray: true })
  @ApiNotFoundResponse({
    description: 'Conversación no encontrada o el usuario no es participante',
  })
  listMessages(
    @Param('id', ParseUUIDPipe) conversationId: string,
    @Query() query: MessagesQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.chatsService.listMessages(user.sub, conversationId, query);
  }

  @Post(':id/messages')
  @ApiParam({ name: 'id', description: 'ID (UUID) de la conversación' })
  @ApiOperation({
    summary: 'Enviar un mensaje en una conversación',
    description:
      'Texto, o una publicación (workoutPostId) o un challenge (challengeId) compartido, con texto opcional. El remitente debe poder ver la publicación que comparte (404 si no).',
  })
  @ApiOkResponse({ type: MessageDto })
  @ApiNotFoundResponse({
    description: 'Conversación no encontrada o el usuario no es participante',
  })
  @ApiForbiddenResponse({
    description:
      'El usuario todavía no acepta esta solicitud de mensaje (debe aceptarla antes de responder)',
  })
  sendMessage(
    @Param('id', ParseUUIDPipe) conversationId: string,
    @Body() dto: SendMessageDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.chatsService.sendMessage(
      user.sub,
      conversationId,
      dto.content,
      {
        workoutPostId: dto.workoutPostId,
        challengeId: dto.challengeId,
      },
    );
  }

  @Delete(':id/messages/:messageId')
  @ApiParam({ name: 'id', description: 'ID (UUID) de la conversación' })
  @ApiParam({ name: 'messageId', description: 'ID del mensaje' })
  @ApiOperation({
    summary: 'Eliminar un mensaje propio',
    description:
      'Soft delete (is_active = false) de un mensaje enviado por el usuario autenticado. La conversación y el resto de mensajes se conservan.',
  })
  @ApiOkResponse({ description: 'Mensaje eliminado' })
  @ApiNotFoundResponse({
    description:
      'Conversación no encontrada, el usuario no es participante, o el mensaje no existe en esa conversación',
  })
  @ApiForbiddenResponse({
    description: 'Solo quien envió el mensaje puede eliminarlo',
  })
  deleteMessage(
    @Param('id', ParseUUIDPipe) conversationId: string,
    @Param('messageId', ParseIntPipe) messageId: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.chatsService.deleteMessage(user.sub, conversationId, messageId);
  }

  @Patch(':id/read')
  @ApiParam({ name: 'id', description: 'ID (UUID) de la conversación' })
  @ApiOperation({
    summary: 'Marcar como leídos los mensajes de una conversación',
    description:
      'Marca como leídos todos los mensajes enviados por el otro participante.',
  })
  @ApiOkResponse({ description: 'Cantidad de mensajes marcados como leídos' })
  @ApiNotFoundResponse({
    description: 'Conversación no encontrada o el usuario no es participante',
  })
  markRead(
    @Param('id', ParseUUIDPipe) conversationId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.chatsService.markConversationRead(user.sub, conversationId);
  }

  @Patch(':id/accept')
  @ApiParam({ name: 'id', description: 'ID (UUID) de la conversación' })
  @ApiOperation({ summary: 'Aceptar una solicitud de mensaje' })
  @ApiOkResponse({ type: ConversationSummaryDto })
  @ApiNotFoundResponse({ description: 'Conversación no encontrada' })
  acceptRequest(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.chatsService.acceptRequest(user.sub, id);
  }

  @Delete(':id/decline')
  @ApiParam({ name: 'id', description: 'ID (UUID) de la conversación' })
  @ApiOperation({
    summary:
      'Rechazar una solicitud de mensaje (elimina la conversación para ambos)',
  })
  @ApiOkResponse({ description: 'Conversación rechazada' })
  @ApiNotFoundResponse({ description: 'Conversación no encontrada' })
  declineRequest(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.chatsService.declineRequest(user.sub, id);
  }

  @Delete(':id')
  @ApiParam({ name: 'id', description: 'ID (UUID) de la conversación' })
  @ApiOperation({
    summary: 'Eliminar una conversación de mi lista',
    description:
      'Oculta la conversación solo para el usuario autenticado; el otro participante la conserva y los mensajes no se borran. Vuelve a aparecer si se envía un mensaje nuevo en ella. Idempotente.',
  })
  @ApiOkResponse({ description: 'Conversación ocultada' })
  @ApiNotFoundResponse({
    description: 'Conversación no encontrada o el usuario no es participante',
  })
  hideConversation(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.chatsService.hideConversation(user.sub, id);
  }
}
