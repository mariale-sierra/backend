import { ForbiddenException } from '@nestjs/common';

/**
 * Single-tenant, per-user ownership check. Throws `ForbiddenException` when
 * the resource's owner id does not match the currently authenticated user's
 * id (`req.user.sub`). Callers must resolve the resource first and throw
 * `NotFoundException` themselves when it doesn't exist — this helper only
 * ever expresses "found but not yours".
 */
export function assertOwnership(
  resourceUserId: string | null | undefined,
  currentUserId: string,
  message = 'You do not have access to this resource',
): void {
  if (resourceUserId !== currentUserId) {
    throw new ForbiddenException(message);
  }
}
