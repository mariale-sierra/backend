import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { WorkoutPostsService } from './workout-posts.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';

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
