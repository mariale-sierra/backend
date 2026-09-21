import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../users/entities/user.entity';

/**
 * Bloque 1 — global platform admin only (`users.is_admin`, see
 * 2026-09-21-01-add-user-is-admin.sql). Always runs AFTER `JwtAuthGuard` (registered
 * globally in app.module.ts via APP_GUARD, so it has already populated `request.user`
 * by the time this runs) — this guard only adds the extra admin check on top.
 *
 * The JWT payload itself (`{ sub, email, username }`, see AuthService.signToken) never
 * carries `is_admin` — admin status is looked up fresh from the database on every
 * admin-gated request, not trusted from a token that could otherwise stay valid (and
 * "admin") for days after being revoked. The one DB round trip this costs is only paid
 * by the small number of admin-only routes (close-challenge, ban/unban), not every
 * request in the app.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(
    @InjectRepository(User)
    private userRepo: Repository<User>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const userId = request.user?.sub;
    if (!userId) throw new ForbiddenException('Admin only');

    const user = await this.userRepo.findOne({
      where: { id: userId },
      select: ['id', 'is_admin'],
    });
    if (!user?.is_admin) {
      throw new ForbiddenException('Admin only');
    }
    return true;
  }
}
