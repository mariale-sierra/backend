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
  private moderationColumnsSupportPromise?: Promise<boolean>;

  constructor(
    @InjectRepository(WorkoutPost)
    private repo: Repository<WorkoutPost>,
    private moderationService: ModerationService,
  ) {}

  private async supportsModerationColumns() {
    if (!this.moderationColumnsSupportPromise) {
      this.moderationColumnsSupportPromise = this.repo
        .query(
          `SELECT COUNT(*)::int AS count
           FROM information_schema.columns
           WHERE table_schema = 'havit'
             AND table_name = 'workout_posts'
             AND column_name IN ('moderation_status', 'moderation_reason', 'moderated_at')`,
        )
        .then((rows: Array<{ count: number | string }>) => {
          const count = Number(rows?.[0]?.count ?? 0);
          return count === 3;
        })
        .catch(() => false);
    }

    return this.moderationColumnsSupportPromise;
  }

  async create(data: Partial<WorkoutPost>) {
    const supportsModeration = await this.supportsModerationColumns();
    const post = this.repo.create() as WorkoutPost;
    Object.assign(post, data);

    if (supportsModeration) {
      Object.assign(post, {
        moderationStatus: WorkoutPostModerationStatus.PENDING,
        moderationReason: undefined,
        moderatedAt: undefined,
      });
    }

    const savedPost = await this.repo.save(post);

    if (supportsModeration && savedPost.image_url) {
      void this.reviewPostModeration(savedPost.id, savedPost.image_url, savedPost.caption);
    }

    return savedPost;
  }

  private async reviewPostModeration(
    postId: number,
    imageUrl: string,
    caption?: string,
  ) {
    if (!(await this.supportsModerationColumns())) {
      return;
    }

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
    const supportsModeration = await this.supportsModerationColumns();

    const posts = await this.repo
      .createQueryBuilder('post')
      .innerJoinAndSelect('post.workoutLog', 'workoutLog')
      .where('workoutLog.challenge_id = :challengeId', { challengeId })
      .orderBy('post.created_at', 'DESC')
      .getMany();

    const filteredPosts = supportsModeration
      ? posts.filter(
          (post) =>
            post.moderationStatus === WorkoutPostModerationStatus.APPROVED,
        )
      : posts;

    return {
      message: 'Workout posts retrieved successfully',
      data: filteredPosts.map((post) => ({
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
