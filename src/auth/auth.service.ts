import { Injectable, UnauthorizedException, BadRequestException} from '@nestjs/common';
import { createClient } from '@supabase/supabase-js';
import { ConfigService } from '@nestjs/config';
import { LoginDto } from './dto/login.dto';
import { UsersService } from '../users/users.service';
import { RegisterDto } from './dto/register.dto';

@Injectable()
export class AuthService {
  private supabase;

  constructor(
    private configService: ConfigService,
    private usersService: UsersService, 
  ) {
    this.supabase = createClient(
      this.configService.getOrThrow<string>('SUPABASE_URL'),
      this.configService.getOrThrow<string>('SUPABASE_ANON_KEY'),
    );
  }

  async login(loginDto: LoginDto) {
    const { email, password } = loginDto;

    const { data, error } = await this.supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      throw new UnauthorizedException('Invalid email or password');
    }

    return {
      accessToken: data.session.access_token,
      user: {
        id: data.user.id,
        email: data.user.email,
      },
    };
  }

  async register(regisDto: RegisterDto) {
    const { email, password } = regisDto;

    const { data, error } = await this.supabase.auth.signUp({
      email,
      password,
    });

    if (error) {
    console.log(error);
    throw new BadRequestException(error.message);
    }

    if (!data.user) {
      throw new UnauthorizedException('User not created');
    }

    const supabaseUserId = data.user.id;

    try {
      const createdUser = await this.usersService.register({
        username: regisDto.username, 
      });

      return {
        message: 'User registered successfully',
        authUser: {
          id: supabaseUserId,
          email: data.user.email,
        },
        appUser: createdUser,
      };
    } catch (dbError) {
      throw new UnauthorizedException('Failed to create user profile, rolled back Supabase user');
    }
  }
}