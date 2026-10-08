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
import { NotificationsService } from '../notifications/notifications.service';
import { DecodedCursor, encodeCursor } from '../common/pagination.util';
import { CommentAuthorDto } from './dto/comment-author.dto';

export interface ReactionSummary {
  count: number;
  reactedByMe: boolean;
}

/** One person who reacted to a post — same restricted user summary as a
 * comment's author (never email/password). */
export class ReactorDto extends CommentAuthorDto {}

interface ReactorRow {
  workout_post_id: string;
  user_id: string;
  username: string;
  display_name: string | null;
  profile_image_url: string | null;
  created_at: Date;
}

@Injectable()
export class WorkoutPostReactionsService {
  constructor(
    @InjectRepository(WorkoutPostLike)
    private likeRepo: Repository<WorkoutPostLike>,
    @InjectRepository(WorkoutPost)
    private postRepo: Repository<WorkoutPost>,
    private notificationsService: NotificationsService,
  ) {}

  /** Only one reaction type exists ('like'), enforced one-per-user-per-post
   * by workout_post_likes' composite PK — see the entity's own doc comment. */
  private async loadReactablePost(
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

  async react(postId: string, userId: string): Promise<{ message: string }> {
    const post = await this.loadReactablePost(postId, userId);

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

    // The owner can always see their own post; loadReactablePost already
    // refused hidden posts. Several likes in a row collapse into the same
    // unread notification (see NotificationsService.notify).
    void this.notificationsService.notify({
      recipientUserId: post.user_id,
      actorUserId: userId,
      type: 'post_reaction',
      entity: { type: 'workout_post', id: post.id },
    });
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

  /**
   * "Who reacted" (Sprint 9, B5): the reaction redesign shows people, not a
   * number, so this lists them newest first. Same visibility gate as every
   * other reaction endpoint. Accounts that were deactivated drop out of the
   * list. Keyset-paginated on (created_at, user_id) like the Feed.
   */
  async listReactors(
    postId: string,
    viewerId: string,
    options: { limit: number; cursor?: DecodedCursor },
  ): Promise<{ reactors: ReactorDto[]; nextCursor?: string }> {
    await this.loadReactablePost(postId, viewerId);

    const params: unknown[] = [postId];
    let cursorFilter = '';
    if (options.cursor) {
      params.push(options.cursor.createdAt, options.cursor.id);
      cursorFilter = `AND (l.created_at, l.user_id) < ($2, $3)`;
    }
    params.push(options.limit + 1);

    const rows: ReactorRow[] = await this.likeRepo.manager.query(
      `SELECT l.workout_post_id, l.user_id, l.created_at,
              u.username, up.display_name, up.profile_image_url
       FROM havit.workout_post_likes l
       JOIN havit.users u ON u.id = l.user_id AND u.is_active = true
       LEFT JOIN havit.user_profiles up ON up.user_id = l.user_id
       WHERE l.workout_post_id = $1 ${cursorFilter}
       ORDER BY l.created_at DESC, l.user_id DESC
       LIMIT $${params.length}`,
      params,
    );

    const hasNextPage = rows.length > options.limit;
    const page = hasNextPage ? rows.slice(0, options.limit) : rows;
    const last = page[page.length - 1];
    return {
      reactors: page.map((r) => this.toReactorDto(r)),
      nextCursor:
        hasNextPage && last
          ? encodeCursor(last.created_at, last.user_id)
          : undefined,
    };
  }

  /**
   * Up to `perPost` reactors per post for the Feed card ("Ana, Luis and 3
   * more"), in one window-function query for the whole page. People the
   * viewer follows come first — they're who the viewer recognizes — then
   * newest. The viewer is left out (the card already knows `liked_by_me`).
   */
  async getRecentReactorsForPosts(
    postIds: string[],
    viewerId: string | undefined,
    perPost = 3,
  ): Promise<Map<string, ReactorDto[]>> {
    const result = new Map<string, ReactorDto[]>();
    if (postIds.length === 0) return result;

    const rows: ReactorRow[] = await this.likeRepo.manager.query(
      `SELECT workout_post_id, user_id, created_at, username, display_name, profile_image_url
       FROM (
         SELECT l.workout_post_id, l.user_id, l.created_at,
                u.username, up.display_name, up.profile_image_url,
                ROW_NUMBER() OVER (
                  PARTITION BY l.workout_post_id
                  ORDER BY (uf.follower_user_id IS NOT NULL) DESC, l.created_at DESC
                ) AS rn
         FROM havit.workout_post_likes l
         JOIN havit.users u ON u.id = l.user_id AND u.is_active = true
         LEFT JOIN havit.user_profiles up ON up.user_id = l.user_id
         LEFT JOIN havit.user_follows uf
                ON uf.follower_user_id = $2
               AND uf.followed_user_id = l.user_id
               AND uf.is_active = true
         WHERE l.workout_post_id = ANY($1)
           AND ($2::uuid IS NULL OR l.user_id != $2)
       ) ranked
       WHERE rn <= $3
       ORDER BY workout_post_id, rn`,
      [postIds, viewerId ?? null, perPost],
    );

    for (const row of rows) {
      const list = result.get(row.workout_post_id) ?? [];
      list.push(this.toReactorDto(row));
      result.set(row.workout_post_id, list);
    }
    return result;
  }

  private toReactorDto(row: ReactorRow): ReactorDto {
    const dto = new ReactorDto();
    dto.id = row.user_id;
    dto.username = row.username;
    dto.displayName = row.display_name;
    dto.profileImageUrl = row.profile_image_url;
    return dto;
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
