import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * JWT payload shape attached to `request.user` by `JwtAuthGuard`.
 * Mirrors the claims signed in `AuthService.signAccessToken`.
 */
export interface AuthenticatedUser {
  sub: string;
  email: string;
  username: string;
  /** B4 session id; absent on 7-day tokens issued before B4. */
  sid?: string;
}

/**
 * Param decorator that pulls the authenticated user's JWT payload off the
 * request. Equivalent to `@Req() req` + `req.user`, kept as a small
 * reusable helper so ownership checks read consistently across controllers.
 *
 * Usage:
 *   update(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
 *     return this.service.update(id, user.sub);
 *   }
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);
