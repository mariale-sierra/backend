import { SetMetadata } from '@nestjs/common';

/**
 * Marks a route (or an entire controller) as not requiring authentication.
 * The global `JwtAuthGuard` (registered as APP_GUARD in AppModule) checks for
 * this metadata and skips the JWT check when present.
 *
 * Usage:
 *   @Public()
 *   @Get()
 *   findAll() { ... }
 */
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
