import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { extractHashtags } from './hashtag.util';

/**
 * #hashtags on workout posts (Sprint 9, B5). Tags live in their own tables
 * (havit.hashtags + havit.workout_post_hashtags) rather than a text column on
 * workout_posts, so a later "posts with #tag" search/grouping is an indexed
 * join — this sprint only stores and returns them.
 */
@Injectable()
export class HashtagsService {
  constructor(@InjectDataSource() private dataSource: DataSource) {}

  /**
   * Replaces a post's tags with the ones in `caption`. `manager`, when given,
   * runs inside the caller's transaction (WorkoutPostsService.create is
   * called inside WorkoutLogService.createWorkout's), so a post and its tags
   * are committed or rolled back together.
   */
  async syncPostHashtags(
    postId: string,
    caption: string | null | undefined,
    manager: EntityManager = this.dataSource.manager,
  ): Promise<string[]> {
    const tags = extractHashtags(caption);

    await manager.query(
      `DELETE FROM havit.workout_post_hashtags WHERE workout_post_id = $1`,
      [postId],
    );
    if (tags.length === 0) return tags;

    // lower() again in SQL: hashtags.tag has CHECK (tag = lower(tag)), and
    // JS toLowerCase() and Postgres lower() can disagree on rare characters
    // — a mismatch there must not fail (and roll back) the post itself.
    await manager.query(
      `INSERT INTO havit.hashtags (tag)
       SELECT DISTINCT lower(t) FROM UNNEST($1::varchar[]) AS t
       ON CONFLICT (tag) DO NOTHING`,
      [tags],
    );
    await manager.query(
      `INSERT INTO havit.workout_post_hashtags (workout_post_id, hashtag_id)
       SELECT $1, h.id FROM havit.hashtags h
       WHERE h.tag IN (SELECT lower(t) FROM UNNEST($2::varchar[]) AS t)
       ON CONFLICT DO NOTHING`,
      [postId, tags],
    );
    return tags;
  }

  /** Tags of many posts at once (Feed), one query for the whole page. */
  async getTagsForPosts(postIds: string[]): Promise<Map<string, string[]>> {
    const result = new Map<string, string[]>();
    if (postIds.length === 0) return result;

    const rows: Array<{ workout_post_id: string; tag: string }> =
      await this.dataSource.query(
        `SELECT ph.workout_post_id, h.tag
         FROM havit.workout_post_hashtags ph
         JOIN havit.hashtags h ON h.id = ph.hashtag_id
         WHERE ph.workout_post_id = ANY($1)
         ORDER BY h.tag`,
        [postIds],
      );
    for (const row of rows) {
      const list = result.get(row.workout_post_id) ?? [];
      list.push(row.tag);
      result.set(row.workout_post_id, list);
    }
    return result;
  }
}
