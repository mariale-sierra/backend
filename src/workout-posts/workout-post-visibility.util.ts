import { ForbiddenException } from '@nestjs/common';
import { WorkoutPost } from './entities/workout-post.entity';

/**
 * A post marked 'private' can only be reacted to / commented on by its own
 * owner. There's no single "GET one post" endpoint in this module to
 * otherwise gate this against (existing visibility filtering only applies
 * to the list queries in WorkoutPostsService), so reactions/comments check
 * this directly against the already-loaded row. Deliberately does not also
 * replicate the 'followers' visibility/follow-relationship check — that
 * would need FollowsService wired into two more services for a narrower
 * gap (a non-follower could react/comment on a followers-only post) than
 * the private-post case, which is unambiguously wrong regardless of any
 * follow relationship.
 */
export function assertPostVisibleToUser(
  post: WorkoutPost,
  userId: string,
): void {
  if (post.visibility === 'private' && post.user_id !== userId) {
    throw new ForbiddenException('You do not have access to this post');
  }
}
