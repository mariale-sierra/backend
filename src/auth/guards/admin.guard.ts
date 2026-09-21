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
 * Global-admin gate for platform-level actions (ban a user, close any
 * challenge). Runs after JwtAuthGuard (global), which already populated
 * `request.user`. No @Roles()/Reflector needed — unlike @Public(), this
 * doesn't vary per route, it's applied explicitly with
 * @UseGuards(AdminGuard) only on the handful of admin-only endpoints.
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
    if (!userId) throw new ForbiddenException('Admin access required');

    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user?.is_admin) {
      throw new ForbiddenException('Admin access required');
    }

    return true;
  }
}
