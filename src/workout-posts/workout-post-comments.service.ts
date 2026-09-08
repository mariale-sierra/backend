import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WorkoutPostComment } from './entities/workout-post-comment.entity';
import { WorkoutPost } from './entities/workout-post.entity';
import { CommentDto } from './dto/comment.dto';
import { assertOwnership } from '../auth/utils/assert-ownership';
import { assertPostVisibleToUser } from './workout-post-visibility.util';

export const DEFAULT_COMMENTS_LIMIT = 20;
export const MAX_COMMENTS_LIMIT = 50;

export interface ListCommentsResult {
  comments: CommentDto[];
  nextAfter: number | null;
}

@Injectable()
export class WorkoutPostCommentsService {
  constructor(
    @InjectRepository(WorkoutPostComment)
    private commentRepo: Repository<WorkoutPostComment>,
    @InjectRepository(WorkoutPost)
    private postRepo: Repository<WorkoutPost>,
  ) {}

  private async loadCommentablePost(
    postId: string,
    userId: string,
  ): Promise<WorkoutPost> {
    const post = await this.postRepo.findOne({ where: { id: postId } });
    if (!post) throw new NotFoundException('Workout post not found');
    assertPostVisibleToUser(post, userId);
    return post;
  }

  /**
   * Persists and returns a new comment. Deliberately does NOT run any
   * content moderation yet — same reasoning as ChatsService.sendMessage /
   * SpacesService.sendMessage: Esteban's Moderation API (Bloque 4) isn't
   * wired to any text-content surface yet, and the existing
   * ModerationService.validateWorkoutImage() contract requires an image URL
   * (built for post photos), so there's no text-only contract to integrate
   * against here without inventing one. This is the call site once that
   * contract exists.
   */
  async create(
    postId: string,
    userId: string,
    content: string,
  ): Promise<CommentDto> {
    await this.loadCommentablePost(postId, userId);

    const comment = this.commentRepo.create({
      workout_post_id: postId,
      user_id: userId,
      comment_text: content,
    });
    const saved = await this.commentRepo.save(comment);

    const withAuthor = await this.commentRepo.findOne({
      where: { id: saved.id },
      relations: { author: { profile: true } },
    });
    return this.toCommentDto(withAuthor!);
  }

  /**
   * Oldest-first, keyset-paginated by id (ascending) — comments read
   * top-to-bottom like a thread, unlike Feed/space messages which page
   * newest-first.
   */
  async list(
    postId: string,
    userId: string,
    options: { after?: number; limit?: number },
  ): Promise<ListCommentsResult> {
    await this.loadCommentablePost(postId, userId);

    const limit = Math.min(
      options.limit ?? DEFAULT_COMMENTS_LIMIT,
      MAX_COMMENTS_LIMIT,
    );

    const qb = this.commentRepo
      .createQueryBuilder('c')
      .leftJoinAndSelect('c.author', 'author')
      .leftJoinAndSelect('author.profile', 'profile')
      .where('c.workout_post_id = :postId', { postId })
      .andWhere('c.is_active = true')
      .orderBy('c.id', 'ASC')
      .take(limit + 1);

    if (options.after !== undefined) {
      qb.andWhere('c.id > :after', { after: options.after });
    }

    const rows = await qb.getMany();
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const nextAfter = hasMore ? page[page.length - 1].id : null;

    return { comments: page.map((c) => this.toCommentDto(c)), nextAfter };
  }

  async remove(
    postId: string,
    commentId: number,
    userId: string,
  ): Promise<{ message: string }> {
    const comment = await this.commentRepo.findOne({
      where: { id: commentId, workout_post_id: postId, is_active: true },
    });
    if (!comment) throw new NotFoundException('Comment not found');
    assertOwnership(
      comment.user_id,
      userId,
      'You can only delete your own comments',
    );

    comment.is_active = false;
    await this.commentRepo.save(comment);

    return { message: 'Comment deleted' };
  }

  /** Comment counts for many posts at once (Feed), one grouped query instead
   * of one COUNT per post — same batching pattern as
   * FollowsService.getFollowerCountsForUsers. */
  async getCountsForPosts(postIds: string[]): Promise<Map<string, number>> {
    if (postIds.length === 0) return new Map();
    const rows = await this.commentRepo
      .createQueryBuilder('c')
      .select('c.workout_post_id', 'postId')
      .addSelect('COUNT(*)', 'count')
      .where('c.workout_post_id IN (:...postIds)', { postIds })
      .andWhere('c.is_active = true')
      .groupBy('c.workout_post_id')
      .getRawMany<{ postId: string; count: string }>();
    return new Map(rows.map((r) => [r.postId, Number(r.count)]));
  }

  private toCommentDto(comment: WorkoutPostComment): CommentDto {
    const dto = new CommentDto();
    dto.id = comment.id;
    dto.workoutPostId = comment.workout_post_id;
    dto.author = {
      id: comment.author?.id ?? comment.user_id,
      username: comment.author?.username ?? '',
      displayName: comment.author?.profile?.display_name ?? null,
      profileImageUrl: comment.author?.profile?.profile_image_url ?? null,
    };
    dto.content = comment.comment_text;
    dto.createdAt = comment.created_at;
    return dto;
  }
}
