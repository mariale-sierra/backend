import { ForbiddenException } from '@nestjs/common';
import { WorkoutPost } from './entities/workout-post.entity';

/** Runs a read-only SQL statement (e.g. `repo.manager.query`) and returns its rows. */
export type PostVisibilityQuery = (
  sql: string,
  params: unknown[],
) => Promise<unknown[]>;

/**
 * Same read rules as the feed (WorkoutPostsService.postVisibilityFilter), for the endpoints that
 * reach a post by its id (reactions, comments, reports):
 *  - the author always passes;
 *  - 'private' posts: nobody else;
 *  - 'followers' posts: only viewers who actively follow the author;
 *  - a post inside a private challenge: only members of that challenge.
 * Knowing a post's UUID is therefore never enough to interact with it.
 */
const POST_VISIBLE_TO_VIEWER_SQL = `
  SELECT 1
  FROM havit.workout_posts p
  LEFT JOIN havit.workout_logs wl ON wl.id = p.workout_log_id
  LEFT JOIN havit.challenges c ON c.id = wl.challenge_id
  WHERE p.id = $1
    AND (
      p.visibility != 'followers'
      OR EXISTS (
        SELECT 1 FROM havit.user_follows uf
        WHERE uf.follower_user_id = $2
          AND uf.followed_user_id = p.user_id
          AND uf.is_active = true
      )
    )
    AND (
      c.visibility IS DISTINCT FROM 'private'
      OR EXISTS (
        SELECT 1 FROM havit.challenge_user_map cum
        WHERE cum.challenge_id = wl.challenge_id
          AND cum.user_id = $2
      )
    )
  LIMIT 1`;

export async function assertPostVisibleToUser(
  post: WorkoutPost,
  userId: string,
  query: PostVisibilityQuery,
): Promise<void> {
  if (post.user_id === userId) return;
  if (post.visibility === 'private') {
    throw new ForbiddenException('You do not have access to this post');
  }
  const rows = await query(POST_VISIBLE_TO_VIEWER_SQL, [post.id, userId]);
  if (rows.length === 0) {
    throw new ForbiddenException('You do not have access to this post');
  }
}
