import {Injectable, UnauthorizedException, ConflictException} from '@nestjs/common';
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