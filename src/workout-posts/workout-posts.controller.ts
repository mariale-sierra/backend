import { Controller, Get, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { WorkoutPostsService } from './workout-posts.service';

@ApiTags('Workout Posts')
@Controller('workout-posts')
export class WorkoutPostsController {
  constructor(private readonly workoutPostsService: WorkoutPostsService) {}

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
