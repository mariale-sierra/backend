import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { WorkoutPostLike } from './entities/workout-post-like.entity';
import { WorkoutPost } from './entities/workout-post.entity';
import { assertPostVisibleToUser } from './workout-post-visibility.util';

export interface ReactionSummary {
  count: number;
  reactedByMe: boolean;
}

@Injectable()
export class WorkoutPostReactionsService {
  constructor(
    @InjectRepository(WorkoutPostLike)
    private likeRepo: Repository<WorkoutPostLike>,
    @InjectRepository(WorkoutPost)
    private postRepo: Repository<WorkoutPost>,
  ) {}

  /** Only one reaction type exists ('like'), enforced one-per-user-per-post
   * by workout_post_likes' composite PK — see the entity's own doc comment. */
  private async loadReactablePost(
    postId: string,
    userId: string,
  ): Promise<WorkoutPost> {
    const post = await this.postRepo.findOne({ where: { id: postId } });
    if (!post) throw new NotFoundException('Workout post not found');
    assertPostVisibleToUser(post, userId);
    return post;
  }

  async react(postId: string, userId: string): Promise<{ message: string }> {
    await this.loadReactablePost(postId, userId);

    const existing = await this.likeRepo.findOne({
      where: { workout_post_id: postId, user_id: userId },
    });
    if (existing) {
      throw new ConflictException('You already reacted to this post');
    }

    const like = this.likeRepo.create({
      workout_post_id: postId,
      user_id: userId,
    });

    try {
      await this.likeRepo.save(like);
    } catch (error) {
      // Composite PK backs this up at the DB level — translate the
      // race-condition duplicate into a 409, same pattern as
      // FollowsService.follow.
      if ((error as { code?: string })?.code === '23505') {
        throw new ConflictException('You already reacted to this post');
      }
      throw error;
    }

    return { message: 'Reaction added' };
  }

  async unreact(postId: string, userId: string): Promise<{ message: string }> {
    const existing = await this.likeRepo.findOne({
      where: { workout_post_id: postId, user_id: userId },
    });
    if (!existing) {
      throw new NotFoundException('You have not reacted to this post');
    }

    await this.likeRepo.remove(existing);

    return { message: 'Reaction removed' };
  }

  async getSummary(postId: string, userId: string): Promise<ReactionSummary> {
    await this.loadReactablePost(postId, userId);

    const [count, reacted] = await Promise.all([
      this.likeRepo.count({ where: { workout_post_id: postId } }),
      this.likeRepo.findOne({
        where: { workout_post_id: postId, user_id: userId },
      }),
    ]);

    return { count, reactedByMe: !!reacted };
  }

  /** Reaction counts for many posts at once (Feed), one grouped query instead
   * of one COUNT per post — same batching pattern as
   * FollowsService.getFollowerCountsForUsers. */
  async getCountsForPosts(postIds: string[]): Promise<Map<string, number>> {
    if (postIds.length === 0) return new Map();
    const rows = await this.likeRepo
      .createQueryBuilder('l')
      .select('l.workout_post_id', 'postId')
      .addSelect('COUNT(*)', 'count')
      .where('l.workout_post_id IN (:...postIds)', { postIds })
      .groupBy('l.workout_post_id')
      .getRawMany<{ postId: string; count: string }>();
    return new Map(rows.map((r) => [r.postId, Number(r.count)]));
  }

  /** Which of `postIds` the given user has reacted to (Feed's `liked_by_me`). */
  async getReactedPostIds(
    postIds: string[],
    userId: string,
  ): Promise<Set<string>> {
    if (postIds.length === 0) return new Set();
    const rows = await this.likeRepo.find({
      where: { workout_post_id: In(postIds), user_id: userId },
    });
    return new Set(rows.map((r) => r.workout_post_id));
  }
}
