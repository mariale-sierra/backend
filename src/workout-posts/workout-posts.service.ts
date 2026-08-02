import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  WorkoutPost,
  WorkoutPostModerationStatus,
} from './entities/workout-post.entity';
import { ModerationService } from '../openai/moderation.service';

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
      // Post visibility is 'private' | 'followers'; the gallery model uses
      // 'private' | 'public' (followers-visible reads as public here).
      visibility: r.visibility === 'private' ? 'private' : 'public',
      metrics: metricsByLog.get(String(r.workout_log_id)) ?? [],
      description: r.caption ?? '',
    }));
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
