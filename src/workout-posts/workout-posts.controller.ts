import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { WorkoutPostsService } from './workout-posts.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { CursorPaginationQueryDto } from './dto/cursor-pagination-query.dto';
import { decodeCursor, DEFAULT_PAGE_LIMIT } from './pagination.util';

@ApiTags('Workout Posts')
@Controller('workout-posts')
export class WorkoutPostsController {
  constructor(private readonly workoutPostsService: WorkoutPostsService) {}

  @Get('mine')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Fotos de progreso del usuario autenticado',
    description: 'Devuelve todas las fotos de progreso del usuario (perfil).',
  })
  getMyPhotos(@CurrentUser() user: AuthenticatedUser) {
    return this.workoutPostsService.getUserPhotos(user.sub);
  }

  @Get('challenge/:challengeId')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Fotos de progreso de un challenge',
    description: 'Devuelve las fotos de progreso de un challenge (galería).',
  })
  getChallengePhotos(
    @Param('challengeId', new ParseUUIDPipe()) challengeId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.workoutPostsService.getChallengePhotos(challengeId, user.sub);
  }

  @Get('user/:userId')
  @ApiBearerAuth()
  @ApiParam({ name: 'userId', description: 'ID UUID del usuario' })
  @ApiQuery({
    name: 'cursor',
    required: false,
    description:
      'Cursor opaco de la página anterior (header X-Next-Cursor de la respuesta previa)',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: `Máximo de resultados (default ${DEFAULT_PAGE_LIMIT}, máximo 50)`,
  })
  @ApiOperation({
    summary: 'Publicaciones de un usuario',
    description:
      "Si :userId es el usuario autenticado, devuelve sus propias publicaciones (mismas reglas que /workout-posts/mine). Si es otro usuario, solo publicaciones con visibility='public' AND moderation_status='approved' — no implica ni depende de un sistema de seguidores.",
  })
  @ApiHeader({
    name: 'X-Next-Cursor',
    required: false,
    description: 'Presente solo si existe una página siguiente',
  })
  @ApiResponse({
    status: 200,
    description: 'Publicaciones del usuario, puede ser un arreglo vacío',
  })
  @ApiResponse({
    status: 400,
    description: 'cursor o limit inválido',
  })
  @ApiResponse({ status: 401, description: 'No autorizado' })
  @ApiResponse({
    status: 404,
    description: 'Usuario no encontrado o inactivo',
  })
  async getUserPosts(
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Query() query: CursorPaginationQueryDto,
    @Res({ passthrough: true }) res: Response,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const limit = query.limit ?? DEFAULT_PAGE_LIMIT;
    const cursor = query.cursor ? decodeCursor(query.cursor) : undefined;

    const { photos, nextCursor } = await this.workoutPostsService.getUserPosts(
      userId,
      user.sub,
      { limit, cursor },
    );

    if (nextCursor) {
      res.setHeader('X-Next-Cursor', nextCursor);
    }

    return photos;
  }

  @Get('mosaic')
  @ApiOperation({
    summary: 'Obtener posts para mosaico',
    description:
      'Obtiene posts de workout_posts filtrados por challenge usando workout_logs',
  })
  @ApiQuery({
    name: 'challengeId',
    description: 'ID UUID del challenge',
    example: '51470538-69e6-40c6-a8ac-248a80fcaf4c',
  })
  @ApiResponse({
    status: 200,
    description: 'Posts del mosaico obtenidos exitosamente',
  })
  @ApiResponse({ status: 400, description: 'Challenge ID inválido' })
  findMosaicByChallenge(
    @Query('challengeId', new ParseUUIDPipe()) challengeId: string,
  ) {
    return this.workoutPostsService.findMosaicByChallenge(challengeId);
  }
}
