import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  WorkoutPost,
  WorkoutPostModerationStatus,
} from './entities/workout-post.entity';
import { ModerationService } from '../openai/moderation.service';
import { User } from '../users/entities/user.entity';
import { DecodedCursor, encodeCursor } from './pagination.util';

/** Shape consumed by the frontend (types/challenge.ts ChallengePhoto). */
export interface ChallengePhoto {
  id: string;
  challengeId: string;
  userName: string;
  imageUrl: string | null;
  day: number;
  visibility: 'public' | 'private';
  metrics: Array<{ label: string; value: string }>;
  description: string;
}

/** Wire contract GET /feed must return exactly (frontend/types/feed.ts
 * FeedPostContract) — snake_case, no envelope, no visibility/moderation
 * fields (the feed is already filtered server-side). */
export interface FeedPostContract {
  id: string;
  user_id: string;
  user_name: string;
  user_avatar_url?: string;
  challenge_id: string;
  challenge_name: string;
  activity_type?: string;
  challenge_day: number;
  image_url?: string;
  caption?: string;
  posted_at: string;
  likes_count?: number;
}

interface PhotoRow {
  id: number | string;
  image_url: string | null;
  caption: string | null;
  visibility: string;
  created_at: Date;
  moderation_status: string | null;
  challenge_id: string;
  workout_log_id: number | string;
  user_name: string;
  joined_at: Date | null;
}

interface FeedRow {
  id: number | string;
  user_id: string;
  image_url: string | null;
  caption: string | null;
  created_at: Date;
  challenge_id: string;
  challenge_name: string;
  user_name: string;
  user_avatar_url: string | null;
  joined_at: Date | null;
}

@Injectable()
export class WorkoutPostsService {
  private moderationColumnsSupportPromise?: Promise<boolean>;

  constructor(
    @InjectRepository(WorkoutPost)
    private repo: Repository<WorkoutPost>,
    @InjectRepository(User)
    private userRepo: Repository<User>,
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
    const post = this.repo.create();
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
      void this.reviewPostModeration(
        savedPost.id,
        savedPost.image_url,
        savedPost.caption,
      );
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

        // A flagged result is a successful, definitive moderation call —
        // apply it immediately, never retry it (retrying can't change a
        // real moderation verdict, only real service errors below should
        // be retried).
        if (result.flagged) {
          await this.repo.update(postId, {
            moderationStatus: WorkoutPostModerationStatus.REJECTED,
            moderationReason:
              result.flaggedCategories.length > 0
                ? `Contenido rechazado por moderación: ${result.flaggedCategories.join(', ')}`
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
        // Only real service/API failures land here (validateWorkoutImage
        // throws ServiceUnavailableException/InternalServerErrorException,
        // it never throws for a flagged result) — retrying those is correct.
        if (attempt < maxAttempts) {
          await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
          continue;
        }

        console.error('MODERATION RETRY EXHAUSTED:', error);
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

  // ---------------------------------------------------------------------
  // Progress photos (challenge gallery + profile grid)
  // ---------------------------------------------------------------------

  /**
   * Which moderation statuses are visible. Production shows only approved
   * photos; a local/dev environment can set PHOTOS_INCLUDE_PENDING=true to also
   * surface pending ones (moderation runs async, so freshly uploaded photos sit
   * as 'pending' until OpenAI approves them).
   */
  private visibleModerationStatuses(): WorkoutPostModerationStatus[] {
    const includePending = process.env.PHOTOS_INCLUDE_PENDING === 'true';
    return includePending
      ? [
          WorkoutPostModerationStatus.APPROVED,
          WorkoutPostModerationStatus.PENDING,
        ]
      : [WorkoutPostModerationStatus.APPROVED];
  }

  /**
   * All progress photos for a challenge, newest first, visible to `viewerId`:
   * public/followers posts from anyone, plus the viewer's own private posts.
   */
  async getChallengePhotos(
    challengeId: string,
    viewerId: string,
  ): Promise<ChallengePhoto[]> {
    return this.fetchPhotos('wl.challenge_id = $1', [challengeId], viewerId);
  }

  /** Every progress photo the given user has posted, across all challenges. */
  async getUserPhotos(userId: string): Promise<ChallengePhoto[]> {
    return this.fetchPhotos('p.user_id = $1', [userId], userId);
  }

  private async fetchPhotos(
    whereClause: string,
    params: unknown[],
    viewerId: string,
  ): Promise<ChallengePhoto[]> {
    const supportsModeration = await this.supportsModerationColumns();

    // The owner always sees their own posts regardless of moderation status
    // (moderation runs async, so a just-uploaded photo sits as 'pending' for
    // a while — hiding it from its own author until OpenAI approves it made
    // fresh uploads disappear from the profile grid). Everyone else still
    // only sees posts that cleared moderation.
    params.push(viewerId);
    const viewerParamIndex = params.length;

    let moderationFilter = '';
    if (supportsModeration) {
      params.push(this.visibleModerationStatuses());
      moderationFilter = `AND (p.moderation_status = ANY($${params.length}) OR p.user_id = $${viewerParamIndex})`;
    }

    // Private posts are only visible to the person who posted them — everyone
    // else only sees public/followers posts, regardless of shared challenge
    // membership.
    const visibilityFilter = `AND (p.visibility != 'private' OR p.user_id = $${viewerParamIndex})`;

    const rows: PhotoRow[] = await this.repo.manager.query(
      `SELECT p.id, p.image_url, p.caption, p.visibility, p.created_at,
              ${supportsModeration ? 'p.moderation_status' : 'NULL AS moderation_status'},
              wl.challenge_id, p.workout_log_id,
              COALESCE(up.display_name, u.username) AS user_name,
              cum.joined_at
       FROM havit.workout_posts p
       JOIN havit.workout_logs wl ON wl.id = p.workout_log_id
       JOIN havit.users u ON u.id = p.user_id
       LEFT JOIN havit.user_profiles up ON up.user_id = p.user_id
       LEFT JOIN havit.challenge_user_map cum
              ON cum.challenge_id = wl.challenge_id AND cum.user_id = p.user_id
       WHERE ${whereClause} ${moderationFilter} ${visibilityFilter}
       ORDER BY p.created_at DESC`,
      params,
    );

    return this.mapRowsToChallengePhotos(rows);
  }

  /** Shared row -> ChallengePhoto enrichment (metrics batch + day calc) used
   * by both the legacy unpaginated fetchPhotos() and the new cursor-paginated
   * fetchPaginatedPhotos(). */
  private async mapRowsToChallengePhotos(
    rows: PhotoRow[],
  ): Promise<ChallengePhoto[]> {
    if (rows.length === 0) return [];

    const metricsByLog = await this.metricsByWorkoutLog(
      rows.map((r) => r.workout_log_id),
    );

    return rows.map((r) => ({
      id: String(r.id),
      challengeId: r.challenge_id,
      userName: r.user_name,
      imageUrl: r.image_url,
      day: this.dayFromJoinedAt(r.joined_at, r.created_at),
      // Post visibility is 'private' | 'followers' | 'public'; the gallery
      // model only distinguishes 'private' | 'public' (followers-visible
      // reads as public here, same as an actual public post).
      visibility: r.visibility === 'private' ? 'private' : 'public',
      metrics: metricsByLog.get(String(r.workout_log_id)) ?? [],
      description: r.caption ?? '',
    }));
  }

  /**
   * Cursor-paginated variant of fetchPhotos(), backing GET
   * /workout-posts/user/:userId. `bypassForOwner` toggles the exact same
   * "owner sees everything" escape hatch fetchPhotos() already applies
   * (visibility != 'private' OR moderation approved, unless it's your own
   * post) — true for "viewing my own posts" (userId === viewer), false for
   * "viewing someone else's posts", which then strictly requires
   * visibility='public' AND moderation_status='approved' with no exception,
   * matching the Feed rule (B2 design, since there is no Followers module to
   * resolve 'followers'-visibility posts for a non-owner viewer).
   */
  private async fetchPaginatedPhotos(
    baseWhereClause: string,
    baseParams: unknown[],
    viewerId: string,
    options: {
      limit: number;
      cursor?: DecodedCursor;
      bypassForOwner: boolean;
    },
  ): Promise<{ photos: ChallengePhoto[]; nextCursor?: string }> {
    const supportsModeration = await this.supportsModerationColumns();
    const params: unknown[] = [...baseParams];

    params.push(viewerId);
    const viewerParamIndex = params.length;

    // Viewing someone else's posts always requires moderation_status='approved'
    // with zero exceptions (same rule as the Feed) — unlike the owner-bypass
    // branch below, this is never conditional on supportsModeration(): the B2
    // rule for a non-owner viewer must never silently degrade to "any
    // moderation status" just because a defensive column-existence check
    // failed. If the column were somehow actually missing, this fails loudly
    // (Postgres error -> 500 via the global exception filter) instead of
    // leaking pending/rejected posts.
    let moderationFilter = `AND p.moderation_status = 'approved'`;
    if (options.bypassForOwner) {
      if (supportsModeration) {
        params.push(this.visibleModerationStatuses());
        moderationFilter = `AND (p.moderation_status = ANY($${params.length}) OR p.user_id = $${viewerParamIndex})`;
      } else {
        moderationFilter = '';
      }
    }

    const visibilityFilter = options.bypassForOwner
      ? `AND (p.visibility != 'private' OR p.user_id = $${viewerParamIndex})`
      : `AND p.visibility = 'public'`;

    let cursorFilter = '';
    if (options.cursor) {
      params.push(options.cursor.createdAt, options.cursor.id);
      cursorFilter = `AND (p.created_at, p.id) < ($${params.length - 1}, $${params.length})`;
    }

    params.push(options.limit + 1);
    const limitParamIndex = params.length;

    const rows: PhotoRow[] = await this.repo.manager.query(
      `SELECT p.id, p.image_url, p.caption, p.visibility, p.created_at,
              ${supportsModeration ? 'p.moderation_status' : 'NULL AS moderation_status'},
              wl.challenge_id, p.workout_log_id,
              COALESCE(up.display_name, u.username) AS user_name,
              cum.joined_at
       FROM havit.workout_posts p
       JOIN havit.workout_logs wl ON wl.id = p.workout_log_id
       JOIN havit.users u ON u.id = p.user_id
       LEFT JOIN havit.user_profiles up ON up.user_id = p.user_id
       LEFT JOIN havit.challenge_user_map cum
              ON cum.challenge_id = wl.challenge_id AND cum.user_id = p.user_id
       WHERE ${baseWhereClause} ${moderationFilter} ${visibilityFilter} ${cursorFilter}
       ORDER BY p.created_at DESC, p.id DESC
       LIMIT $${limitParamIndex}`,
      params,
    );

    const hasNextPage = rows.length > options.limit;
    const pageRows = hasNextPage ? rows.slice(0, options.limit) : rows;

    const photos = await this.mapRowsToChallengePhotos(pageRows);

    const last = pageRows[pageRows.length - 1];
    const nextCursor =
      hasNextPage && last ? encodeCursor(last.created_at, last.id) : undefined;

    return { photos, nextCursor };
  }

  /**
   * Publicaciones de :userId (GET /workout-posts/user/:userId). Self-view
   * (userId === viewerId) mirrors getUserPhotos()/"mine" exactly, now
   * paginated. Viewing another user only returns their public+approved
   * posts — no Followers logic, no use of user_profiles.is_private (that
   * flag only gates the profile bio today, not posts).
   */
  async getUserPosts(
    targetUserId: string,
    viewerId: string,
    options: { limit: number; cursor?: DecodedCursor },
  ): Promise<{ photos: ChallengePhoto[]; nextCursor?: string }> {
    const user = await this.userRepo.findOne({
      where: { id: targetUserId, is_active: true },
    });
    if (!user) throw new NotFoundException('User not found');

    return this.fetchPaginatedPhotos(
      'p.user_id = $1',
      [targetUserId],
      viewerId,
      {
        limit: options.limit,
        cursor: options.cursor,
        bypassForOwner: targetUserId === viewerId,
      },
    );
  }

  /**
   * GET /feed — B2 rule, no exceptions: visibility='public' AND
   * moderation_status='approved', newest first. 'followers'-visibility posts
   * never appear here (for anyone, including their own author) because there
   * is no Followers module yet to resolve who may see them; 'private' and
   * unmoderated ('pending'/'rejected') posts never appear either.
   *
   * The JOIN to `challenges` is intentionally an INNER JOIN, so a post whose
   * workout_log has no challenge_id would silently be excluded here. That's
   * safe today only because every current post-creation path requires a
   * challengeId (CreateWorkoutProgressDto.challengeId is non-optional) — the
   * DB column itself is still nullable. If a future change ever allows
   * creating a challenge-less post, this JOIN needs revisiting (FeedPostContract
   * requires non-null challenge_id/challenge_name, so there's no value to put
   * there without inventing one).
   */
  async getFeed(options: {
    limit: number;
    cursor?: DecodedCursor;
  }): Promise<{ posts: FeedPostContract[]; nextCursor?: string }> {
    const params: unknown[] = [];

    let cursorFilter = '';
    if (options.cursor) {
      params.push(options.cursor.createdAt, options.cursor.id);
      cursorFilter = `AND (p.created_at, p.id) < ($${params.length - 1}, $${params.length})`;
    }

    params.push(options.limit + 1);
    const limitParamIndex = params.length;

    const rows: FeedRow[] = await this.repo.manager.query(
      `SELECT p.id, p.user_id, p.image_url, p.caption, p.created_at, p.workout_log_id,
              wl.challenge_id, c.name AS challenge_name,
              COALESCE(up.display_name, u.username) AS user_name,
              up.profile_image_url AS user_avatar_url,
              cum.joined_at
       FROM havit.workout_posts p
       JOIN havit.workout_logs wl ON wl.id = p.workout_log_id
       JOIN havit.challenges c ON c.id = wl.challenge_id
       JOIN havit.users u ON u.id = p.user_id
       LEFT JOIN havit.user_profiles up ON up.user_id = p.user_id
       LEFT JOIN havit.challenge_user_map cum
              ON cum.challenge_id = wl.challenge_id AND cum.user_id = p.user_id
       WHERE p.visibility = 'public'
         AND p.moderation_status = 'approved'
         ${cursorFilter}
       ORDER BY p.created_at DESC, p.id DESC
       LIMIT $${limitParamIndex}`,
      params,
    );

    const hasNextPage = rows.length > options.limit;
    const pageRows = hasNextPage ? rows.slice(0, options.limit) : rows;

    if (pageRows.length === 0) {
      return { posts: [] };
    }

    // activity_type is intentionally never populated: challenge_category_map
    // (many challenge <-> category) has no "primary category" flag, unlike
    // exercise_category_map (which does, DB-enforced via a unique partial
    // index). There is no unambiguous way to pick a single activity type for
    // a challenge from the current schema, so — per FeedPostContract marking
    // it optional — this omits the field rather than guessing with a
    // deterministic-but-arbitrary tie-break that could show a category the
    // challenge isn't really about.
    const posts: FeedPostContract[] = pageRows.map((r) => ({
      id: String(r.id),
      user_id: r.user_id,
      user_name: r.user_name,
      user_avatar_url: r.user_avatar_url ?? undefined,
      challenge_id: r.challenge_id,
      challenge_name: r.challenge_name,
      challenge_day: this.dayFromJoinedAt(r.joined_at, r.created_at),
      image_url: r.image_url ?? undefined,
      caption: r.caption ?? undefined,
      posted_at: new Date(r.created_at).toISOString(),
    }));

    const last = pageRows[pageRows.length - 1];
    const nextCursor = hasNextPage
      ? encodeCursor(last.created_at, last.id)
      : undefined;

    return { posts, nextCursor };
  }

  /** Exercise summary (name + set count) per workout log, for the photo card. */
  private async metricsByWorkoutLog(
    workoutLogIds: Array<number | string>,
  ): Promise<Map<string, Array<{ label: string; value: string }>>> {
    const map = new Map<string, Array<{ label: string; value: string }>>();
    const ids = [...new Set(workoutLogIds.map((id) => Number(id)))];
    if (ids.length === 0) return map;

    const rows: Array<{
      workout_log_id: number | string;
      exercise_name: string;
      set_count: number | string;
    }> = await this.repo.manager.query(
      `SELECT wle.workout_log_id, e.name AS exercise_name,
              COUNT(wles.id) AS set_count
       FROM havit.workout_log_exercises wle
       JOIN havit.exercises e ON e.id = wle.exercise_id
       LEFT JOIN havit.workout_log_exercise_sets wles
              ON wles.workout_log_exercise_id = wle.id
       WHERE wle.workout_log_id = ANY($1)
       GROUP BY wle.workout_log_id, wle.order_index, e.name
       ORDER BY wle.workout_log_id, wle.order_index`,
      [ids],
    );

    for (const row of rows) {
      const key = String(row.workout_log_id);
      const list = map.get(key) ?? [];
      const sets = Number(row.set_count);
      list.push({
        label: row.exercise_name,
        value: sets > 0 ? `${sets} set${sets === 1 ? '' : 's'}` : 'Logged',
      });
      map.set(key, list);
    }

    return map;
  }

  /** Challenge day (1-indexed, UTC) the photo belongs to, from the poster's
   * join date. Falls back to day 1 when the join date is unknown. */
  private dayFromJoinedAt(joinedAt: Date | null, createdAt: Date): number {
    if (!joinedAt) return 1;
    const msPerDay = 1000 * 60 * 60 * 24;
    const joined = new Date(joinedAt);
    const created = new Date(createdAt);
    const joinedUtc = Date.UTC(
      joined.getUTCFullYear(),
      joined.getUTCMonth(),
      joined.getUTCDate(),
    );
    const createdUtc = Date.UTC(
      created.getUTCFullYear(),
      created.getUTCMonth(),
      created.getUTCDate(),
    );
    return Math.max(Math.floor((createdUtc - joinedUtc) / msPerDay) + 1, 1);
  }
}
