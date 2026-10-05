import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

/** How long a "this account is still usable" answer is reused per user. */
export const SESSION_CHECK_TTL_MS = 30_000;
const MAX_CACHED_SESSIONS = 10_000;

@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly logger = new Logger(JwtAuthGuard.name);
  /** userId -> time until which the account is known to be usable. */
  private readonly validUntil = new Map<string, number>();

  constructor(
    private jwtService: JwtService,
    private configService: ConfigService,
    private reflector: Reflector,
    @InjectDataSource() private dataSource: DataSource,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers['authorization'];

    if (!authHeader) throw new UnauthorizedException('No token provided');

    const token = authHeader.split(' ')[1];
    if (!token) throw new UnauthorizedException('Invalid token format');

    let payload: { sub: string; email: string; username: string };
    try {
      payload = await this.jwtService.verifyAsync(token, {
        secret: this.configService.getOrThrow<string>('JWT_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }

    await this.assertAccountUsable(payload.sub);
    request.user = payload; // { sub, email, username }
    return true;
  }

  /**
   * A signature-valid token can outlive its account: banned (`is_active =
   * false`), purged by B2's account deletion, or simply gone. Without this
   * check every endpoint answered 404/500 one by one for such a token and the
   * app had no clear signal to sign out; now it's a 401 the app logs out on.
   *
   * Cost: one primary-key lookup per user every SESSION_CHECK_TTL_MS (only
   * "usable" answers are cached), so a ban/purge takes effect within 30 s.
   * Accounts with a *pending* deletion stay usable — they must be able to
   * sign in and cancel it (B2). A database error lets the request through
   * (it will fail on its own if the DB is really down) rather than signing
   * every user out on a blip.
   */
  private async assertAccountUsable(userId: string): Promise<void> {
    const cachedUntil = this.validUntil.get(userId);
    if (cachedUntil && cachedUntil > Date.now()) return;

    let rows: Array<{ is_active: boolean; deleted_at: Date | null }>;
    try {
      rows = await this.dataSource.query(
        'SELECT is_active, deleted_at FROM havit.users WHERE id = $1',
        [userId],
      );
    } catch (error) {
      this.logger.warn(
        `session check skipped: ${error instanceof Error ? error.message : String(error)}`,
      );
      return;
    }

    const user = rows[0];
    if (!user || !user.is_active || user.deleted_at) {
      this.validUntil.delete(userId);
      throw new UnauthorizedException('Session is no longer valid');
    }

    if (this.validUntil.size >= MAX_CACHED_SESSIONS) this.validUntil.clear();
    this.validUntil.set(userId, Date.now() + SESSION_CHECK_TTL_MS);
  }
}
