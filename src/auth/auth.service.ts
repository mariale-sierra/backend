import {
  Injectable,
  UnauthorizedException,
  ConflictException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { User } from '../users/entities/user.entity';
import { UserProfile } from '../users/entities/user-profile.entity';

@Injectable()
export class AuthService {
  constructor(
    private jwtService: JwtService,
    private configService: ConfigService,
    private dataSource: DataSource,
    @InjectRepository(User)
    private userRepo: Repository<User>,
  ) {}

  async login(loginDto: LoginDto) {
    const { email, password } = loginDto;

    const user = await this.userRepo.findOne({ where: { email } });
    if (!user) throw new UnauthorizedException('Invalid email or password');

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) throw new UnauthorizedException('Invalid email or password');

    // Bloque 1 — a banned account (UsersService.banUser, admin-only) cannot log back
    // in. Real effect this gives the ban button: it was previously purely cosmetic —
    // is_active existed (and already gated a banned user's public profile/search
    // visibility) but nothing checked it here, so a banned user could keep logging in
    // freely. An already-issued token from before the ban still works until it expires
    // — see UsersService.banUser's own doc comment for why that's an accepted gap here.
    if (!user.is_active) {
      throw new UnauthorizedException('This account has been deactivated');
    }

    return {
      accessToken: await this.signToken(user),
      user: { id: user.id, email: user.email, username: user.username },
    };
  }

  async register(registerDto: RegisterDto) {
    const { email, password, username } = registerDto;

    const existing = await this.userRepo.findOne({ where: { email } });
    if (existing) throw new ConflictException('Email already in use');

    const password_hash = await bcrypt.hash(password, 10);

    const user = await this.dataSource.transaction(async (manager) => {
      const newUser = manager.create(User, { email, username, password_hash });
      const savedUser = await manager.save(newUser);

      const profile = manager.create(UserProfile, {
        user_id: savedUser.id,
        display_name: username,
        preferred_language: 'es',
      });
      await manager.save(profile);

      return savedUser;
    });

    return {
      message: 'User registered successfully',
      accessToken: await this.signToken(user),
      user: { id: user.id, email: user.email, username: user.username },
    };
  }

  private async signToken(user: User): Promise<string> {
    return this.jwtService.signAsync(
      { sub: user.id, email: user.email, username: user.username },
      {
        secret: this.configService.getOrThrow<string>('JWT_SECRET'),
        expiresIn: '7d',
      },
    );
  }
}
