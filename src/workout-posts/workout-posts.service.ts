import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WorkoutPost } from './entities/workout-post.entity';
import { ModerationService } from '../openai/moderation.service';

@Injectable()
export class WorkoutPostsService {
  constructor(
    @InjectRepository(WorkoutPost)
    private repo: Repository<WorkoutPost>,
    private moderationService: ModerationService,
  ) {}

  async create(
    data: Partial<WorkoutPost>,
    options?: { skipModeration?: boolean },
  ) {
    if (!options?.skipModeration && data.image_url) {
      await this.moderationService.validateWorkoutImage(
        data.image_url,
        data.caption,
      );
    }

    const post = this.repo.create(data);
    return this.repo.save(post);
  }

  async findMosaicByChallenge(challengeId: string) {
    const posts = await this.repo
      .createQueryBuilder('post')
      .innerJoinAndSelect('post.workoutLog', 'workoutLog')
      .where('workoutLog.challenge_id = :challengeId', { challengeId })
      .orderBy('post.created_at', 'DESC')
      .getMany();

    return {
      message: 'Workout posts retrieved successfully',
      data: posts.map((post) => ({
        id: post.id,
        workout_log_id: post.workout_log_id,
        user_id: post.user_id,
        image_url: post.image_url,
        caption: post.caption,
        visibility: post.visibility,
        created_at: post.created_at,
        workoutLog: {
          id: post.workoutLog.id,
          challengeId: post.workoutLog.challengeId,
          routineId: post.workoutLog.routineId,
          status: post.workoutLog.status,
          started_at: post.workoutLog.started_at,
        },
      })),
    };
  }
}
