import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';

/** Methods that only read: a suspended user can still browse, just not act. */
const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Routes a suspended user keeps: signing in/out and managing notifications (so they can read
 * why they were suspended).
 */
const ALLOWED_PREFIXES = ['/auth', '/notifications'];

/**
 * Moderation penalty: while `users.suspended_until` is in the future, every write (post, comment,
 * message, join, report...) answers 403 `ACCOUNT_SUSPENDED` with the end date; reading is
 * untouched. Registered globally right after JwtAuthGuard (see app.module.ts), so `request.user`
 * is already set; public routes have no user and pass. Only write requests pay the one primary-key
 * lookup. If the lookup itself fails, the write answers 503 (never allowed through: whether the
 * account is suspended is unknown) and the failure is logged.
 */
@Injectable()
export class SuspensionGuard implements CanActivate {
  private readonly logger = new Logger(SuspensionGuard.name);

  constructor(private readonly dataSource: DataSource) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const userId: string | undefined = request.user?.sub;
    if (!userId || READ_METHODS.has(request.method)) return true;

    const path: string = String(request.originalUrl ?? request.url ?? '');
    if (ALLOWED_PREFIXES.some((prefix) => path.startsWith(prefix))) return true;

    let suspendedUntil: Date | null = null;
    try {
      const rows: Array<{ suspended_until: Date | null }> =
        await this.dataSource.query(
          `SELECT suspended_until FROM havit.users WHERE id = $1`,
          [userId],
        );
      suspendedUntil = rows[0]?.suspended_until ?? null;
    } catch (error) {
      this.logger.error(
        `Suspension lookup failed for user ${userId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw new ServiceUnavailableException({
        message: 'Could not verify your account status. Try again shortly.',
        code: 'SUSPENSION_CHECK_UNAVAILABLE',
      });
    }

    if (suspendedUntil && new Date(suspendedUntil).getTime() > Date.now()) {
      throw new ForbiddenException({
        message:
          'Your activity is suspended until the end of a moderation penalty',
        code: 'ACCOUNT_SUSPENDED',
        suspendedUntil: new Date(suspendedUntil).toISOString(),
      });
    }
    return true;
  }
}
