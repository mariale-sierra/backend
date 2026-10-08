import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  SharedChallengePreviewDto,
  SharedPostPreviewDto,
} from './dto/shared-content.dto';
import { getDominantActivityCategories } from '../challenges/dominant-activity-category.util';

interface PostPreviewRow {
  id: string;
  image_url: string | null;
  caption: string | null;
  user_id: string;
  username: string;
  display_name: string | null;
  profile_image_url: string | null;
  visible: boolean;
}

interface ChallengePreviewRow {
  id: string;
  name: string;
  description: string | null;
  duration_days: number;
  visibility: string;
  members_joined: number | string;
}

/**
 * Resolves the content shared inside direct messages (Sprint 10, B5) — kept
 * out of ChatsService so the conversation logic there doesn't grow SQL for
 * two other modules' tables. Every lookup is batched per page of messages.
 *
 * Post visibility is checked PER VIEWER with the same rules the Feed applies
 * (WorkoutPostsService.getFeed): the author always sees their own post;
 * anyone else needs it approved, in a non-private challenge, and either
 * 'public' or 'followers' + an active follow. Sharing a post into a chat
 * never widens who can see it.
 */
@Injectable()
export class SharedContentService {
  constructor(@InjectDataSource() private dataSource: DataSource) {}

  /** The sender must be able to see what they share; otherwise it's the
   * same 404 as a post that doesn't exist (doesn't confirm it exists). */
  async assertPostShareable(postId: string, senderId: string): Promise<void> {
    const preview = (await this.resolvePosts([postId], senderId)).get(postId);
    if (!preview?.available) {
      throw new NotFoundException('Workout post not found');
    }
  }

  async assertChallengeShareable(challengeId: string): Promise<void> {
    const preview = (await this.resolveChallenges([challengeId])).get(
      challengeId,
    );
    if (!preview?.available) {
      throw new NotFoundException('Challenge not found');
    }
  }

  async resolvePosts(
    postIds: string[],
    viewerId: string,
  ): Promise<Map<string, SharedPostPreviewDto>> {
    const ids = [...new Set(postIds)];
    const result = new Map<string, SharedPostPreviewDto>();
    if (ids.length === 0) return result;

    const rows: PostPreviewRow[] = await this.dataSource.query(
      `SELECT p.id, p.image_url, p.caption, p.user_id,
              u.username, up.display_name, up.profile_image_url,
              (
                p.user_id = $2
                OR (
                  p.moderation_status = 'approved'
                  AND COALESCE(c.visibility, 'public') != 'private'
                  AND (
                    p.visibility = 'public'
                    OR (
                      p.visibility = 'followers'
                      AND EXISTS (
                        SELECT 1 FROM havit.user_follows uf
                        WHERE uf.follower_user_id = $2
                          AND uf.followed_user_id = p.user_id
                          AND uf.is_active = true
                      )
                    )
                  )
                )
              ) AS visible
       FROM havit.workout_posts p
       JOIN havit.users u ON u.id = p.user_id AND u.is_active = true
       LEFT JOIN havit.user_profiles up ON up.user_id = p.user_id
       LEFT JOIN havit.workout_logs wl ON wl.id = p.workout_log_id
       LEFT JOIN havit.challenges c ON c.id = wl.challenge_id
       WHERE p.id = ANY($1)
         AND p.is_active = true
         AND p.is_hidden = false`,
      [ids, viewerId],
    );
    const rowsById = new Map(rows.map((r) => [r.id, r]));

    for (const id of ids) {
      const row = rowsById.get(id);
      const dto = new SharedPostPreviewDto();
      dto.id = id;
      dto.available = !!row?.visible;
      dto.imageUrl = dto.available ? (row?.image_url ?? null) : null;
      dto.caption = dto.available ? (row?.caption ?? null) : null;
      dto.author =
        dto.available && row
          ? {
              id: row.user_id,
              username: row.username,
              displayName: row.display_name,
              profileImageUrl: row.profile_image_url,
            }
          : null;
      result.set(id, dto);
    }
    return result;
  }

  async resolveChallenges(
    challengeIds: string[],
  ): Promise<Map<string, SharedChallengePreviewDto>> {
    const ids = [...new Set(challengeIds)];
    const result = new Map<string, SharedChallengePreviewDto>();
    if (ids.length === 0) return result;

    const [rows, dominantByChallenge] = await Promise.all([
      this.dataSource.query<ChallengePreviewRow[]>(
        `SELECT c.id, c.name, c.description, c.duration_days, c.visibility,
                (SELECT COUNT(*) FROM havit.challenge_user_map cum
                 WHERE cum.challenge_id = c.id AND cum.status = 'active') AS members_joined
         FROM havit.challenges c
         WHERE c.id = ANY($1) AND c.is_active = true`,
        [ids],
      ),
      getDominantActivityCategories(this.dataSource.manager, ids),
    ]);
    const rowsById = new Map(rows.map((r) => [r.id, r]));

    for (const id of ids) {
      const row = rowsById.get(id);
      const dto = new SharedChallengePreviewDto();
      dto.id = id;
      dto.available = !!row;
      dto.name = row?.name ?? null;
      dto.description = row?.description ?? null;
      dto.durationDays = row ? Number(row.duration_days) : null;
      dto.visibility = row?.visibility ?? null;
      dto.membersJoined = row ? Number(row.members_joined) : null;
      dto.dominantActivityCategory = row
        ? (dominantByChallenge.get(id) ?? null)
        : null;
      result.set(id, dto);
    }
    return result;
  }
}
