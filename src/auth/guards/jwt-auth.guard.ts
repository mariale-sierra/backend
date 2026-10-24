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

/** How long a "this account / session is still usable" answer is reused. */
export const SESSION_CHECK_TTL_MS = 30_000;
const MAX_CACHED_SESSIONS = 10_000;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Claims signed by AuthService.signAccessToken. */
interface AccessTokenPayload {
  sub: string;
  email: string;
  username: string;
  /**
   * B4 session id (refresh token family). Missing only on the 7-day tokens
   * issued before B4: those stay valid until they expire, but they have no
   * session to renew (see docs/sprint-10/B4-sesiones-tokens.md).
   */
  sid?: string;
}

/**
 * Cache key -> time until which the answer "usable" is trusted. Shared by
 * every instance of the guard in this process: the global APP_GUARD and the
 * controllers' own @UseGuards(JwtAuthGuard) each get one, and a logout must
 * be able to evict the entry all of them read.
 */
const validUntil = new Map<string, number>();
const cacheKey = (userId: string, sid?: string) =>
  sid ? `s:${sid}` : `u:${userId}`;

@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly logger = new Logger(JwtAuthGuard.name);

  /**
   * Called on logout / revocation: the session stops working on this process
   * immediately instead of when its cached answer expires (other instances,
   * if there ever are several, catch up within SESSION_CHECK_TTL_MS).
   */
  static forgetSession(sid: string): void {
    validUntil.delete(cacheKey('', sid));
  }

  /** Tests only. */
  static clearSessionCache(): void {
    validUntil.clear();
  }

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

    let payload: AccessTokenPayload;
    try {
      payload = await this.jwtService.verifyAsync(token, {
        secret: this.configService.getOrThrow<string>('JWT_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }

    await this.assertSessionUsable(payload.sub, payload.sid);
    request.user = payload; // { sub, email, username, sid? }
    return true;
  }

  /**
   * A signature-valid token can outlive its account: banned (`is_active =
   * false`), purged by B2's account deletion, or simply gone. Without this
   * check every endpoint answered 404/500 one by one for such a token and the
   * app had no clear signal to sign out; now it's a 401 the app logs out on.
   *
   * B4: a token with a `sid` also needs its session (refresh token family)
   * alive — not logged out, not revoked for reuse, not expired. Checked in
   * the SAME lookup and cached the same way, so a logout or a reuse
   * revocation cuts the access token off within SESSION_CHECK_TTL_MS at most
   * (immediately on the process that handled the logout, which evicts the
   * entry), instead of letting it run its 15 minutes.
   *
   * Cost: one primary-key lookup per session every SESSION_CHECK_TTL_MS (only
   * "usable" answers are cached), so a ban/purge takes effect within 30 s.
   * Accounts with a *pending* deletion stay usable — they must be able to
   * sign in and cancel it (B2). A database error lets the request through
   * (it will fail on its own if the DB is really down) rather than signing
   * every user out on a blip.
   */
  private async assertSessionUsable(
    userId: string,
    sid: string | undefined,
  ): Promise<void> {
    // Signed by us, so always a UUID — but it goes into a query whose
    // failure would let the request through: refuse anything else upfront.
    if (sid !== undefined && (typeof sid !== 'string' || !UUID_RE.test(sid))) {
      throw new UnauthorizedException('Session is no longer valid');
    }

    const key = cacheKey(userId, sid);
    const cachedUntil = validUntil.get(key);
    if (cachedUntil && cachedUntil > Date.now()) return;

    let rows: Array<{
      is_active: boolean;
      deleted_at: Date | null;
      session_active?: boolean;
    }>;
    try {
      rows = sid
        ? await this.dataSource.query(
            `SELECT u.is_active, u.deleted_at,
                    EXISTS (
                      SELECT 1 FROM havit.refresh_tokens t
                      WHERE t.family_id = $2 AND t.user_id = u.id
                        AND t.replaced_by IS NULL AND t.revoked_at IS NULL
                        AND t.expires_at > now()
                    ) AS session_active
             FROM havit.users u WHERE u.id = $1`,
            [userId, sid],
          )
        : await this.dataSource.query(
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
    if (
      !user ||
      !user.is_active ||
      user.deleted_at ||
      (sid && !user.session_active)
    ) {
      validUntil.delete(key);
      throw new UnauthorizedException('Session is no longer valid');
    }

    if (validUntil.size >= MAX_CACHED_SESSIONS) validUntil.clear();
    validUntil.set(key, Date.now() + SESSION_CHECK_TTL_MS);
  }
}
