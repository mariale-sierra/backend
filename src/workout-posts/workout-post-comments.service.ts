import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WorkoutPostComment } from './entities/workout-post-comment.entity';
import { WorkoutPost } from './entities/workout-post.entity';
import { CommentDto } from './dto/comment.dto';
import { assertPostVisibleToUser } from './workout-post-visibility.util';
import { ModerationService } from '../openai/moderation.service';
import { NotificationsService } from '../notifications/notifications.service';
import { User } from '../users/entities/user.entity';

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
    private moderationService: ModerationService,
    private notificationsService: NotificationsService,
    // B4: moderator (global admin) lookup for comment deletion.
    @InjectRepository(User)
    private userRepo: Repository<User>,
  ) {}

  private async loadCommentablePost(
    postId: string,
    userId: string,
  ): Promise<WorkoutPost> {
    const post = await this.postRepo.findOne({
      where: { id: postId, is_hidden: false, is_active: true },
    });
    if (!post) throw new NotFoundException('Workout post not found');
    assertPostVisibleToUser(post, userId);
    return post;
  }

  /**
   * Persists and returns a new comment. B3: the text is moderated
   * synchronously (ModerationService.assertTextAllowed) before saving — a
   * flagged comment is rejected with 400 CONTENT_REJECTED and never
   * persisted; if OpenAI can't be reached it fails closed with 503. The
   * post lookup/visibility check runs first so a 404/403 never spends a
   * moderation call. See docs/moderacion-automatica.md.
   */
  async create(
    postId: string,
    userId: string,
    content: string,
  ): Promise<CommentDto> {
    const post = await this.loadCommentablePost(postId, userId);
    await this.moderationService.assertTextAllowed(content);

    const comment = this.commentRepo.create({
      workout_post_id: postId,
      user_id: userId,
      comment_text: content,
    });
    const saved = await this.commentRepo.save(comment);

    // Only ids travel with the notification, never the comment text.
    void this.notificationsService.notify({
      recipientUserId: post.user_id,
      actorUserId: userId,
      type: 'post_comment',
      entity: { type: 'workout_post', id: post.id },
      data: { commentId: String(saved.id) },
    });

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
      .andWhere('c.is_hidden = false')
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

  /**
   * Soft delete (is_active = false) by the comment's author OR a moderator.
   * Sprint 9 B4: "moderator" is the app's existing global admin
   * (`users.is_admin` — the same role AdminGuard gates the report queue,
   * close-challenge and bans behind), looked up fresh from the database like
   * AdminGuard does, never trusted from the JWT. Only queried when the caller
   * isn't the author. Independent of `is_hidden` (report resolution).
   */
  async remove(
    postId: string,
    commentId: number,
    userId: string,
  ): Promise<{ message: string }> {
    const comment = await this.commentRepo.findOne({
      where: { id: commentId, workout_post_id: postId, is_active: true },
    });
    if (!comment) throw new NotFoundException('Comment not found');
    if (comment.user_id !== userId && !(await this.isAdmin(userId))) {
      throw new ForbiddenException('You can only delete your own comments');
    }

    comment.is_active = false;
    await this.commentRepo.save(comment);

    return { message: 'Comment deleted' };
  }

  private async isAdmin(userId: string): Promise<boolean> {
    const user = await this.userRepo.findOne({
      where: { id: userId },
      select: ['id', 'is_admin'],
    });
    return user?.is_admin === true;
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
      .andWhere('c.is_hidden = false')
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
