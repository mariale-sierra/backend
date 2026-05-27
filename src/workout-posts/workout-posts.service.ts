import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  WorkoutPost,
  WorkoutPostModerationStatus,
} from './entities/workout-post.entity';
import { ModerationService } from '../openai/moderation.service';

@Injectable()
export class WorkoutPostsService {
  constructor(
    @InjectRepository(WorkoutPost)
    private repo: Repository<WorkoutPost>,
    private moderationService: ModerationService,
  ) {}

  async create(data: Partial<WorkoutPost>) {
    const post = this.repo.create() as WorkoutPost;
    Object.assign(post, data, {
      moderationStatus: WorkoutPostModerationStatus.PENDING,
      moderationReason: undefined,
      moderatedAt: undefined,
    });

    const savedPost = await this.repo.save(post);

    if (savedPost.image_url) {
      void this.reviewPostModeration(savedPost.id, savedPost.image_url, savedPost.caption);
    }

    return savedPost;
  }

  private async reviewPostModeration(
    postId: number,
    imageUrl: string,
    caption?: string,
  ) {
    const maxAttempts = 3;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const result = await this.moderationService.validateWorkoutImage(
          imageUrl,
          caption,
        );

        if (result.flagged) {
          const flaggedCategories = Object.entries(result.categories)
            .filter(([, isFlagged]) => isFlagged)
            .map(([category]) => category)
            .join(', ');

          await this.repo.update(postId, {
            moderationStatus: WorkoutPostModerationStatus.REJECTED,
            moderationReason:
              flaggedCategories.length > 0
                ? `Contenido rechazado por moderación: ${flaggedCategories}`
                : 'Contenido rechazado por moderación',
            moderatedAt: new Date(),
          });
          return;
        }

        await this.repo.update(postId, {
          moderationStatus: WorkoutPostModerationStatus.APPROVED,
          moderationReason: undefined,
          moderatedAt: new Date(),
        });
        return;
      } catch (error) {
        if (attempt < maxAttempts && error instanceof Error) {
          await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
          continue;
        }

        await this.repo.update(postId, {
          moderationStatus: WorkoutPostModerationStatus.PENDING,
          moderationReason:
            'Pendiente de revisión por moderación no disponible en este momento',
        });
        return;
      }
    }
  }

  async findMosaicByChallenge(challengeId: string) {
    const posts = await this.repo
      .createQueryBuilder('post')
      .innerJoinAndSelect('post.workoutLog', 'workoutLog')
      .where('workoutLog.challenge_id = :challengeId', { challengeId })
      .andWhere('post.moderation_status = :status', {
        status: WorkoutPostModerationStatus.APPROVED,
      })
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
