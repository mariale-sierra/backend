import {
  Injectable,
  OnModuleInit,
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
import { CURRENT_TERMS_VERSION } from './terms-version';
import { getCommonPasswords } from './password-policy';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  RefreshTokensService,
} from './refresh-tokens.service';

export { CURRENT_TERMS_VERSION };

export const INVALID_CREDENTIALS = 'Invalid email or password';
/**
 * B4 / AUDIT M3: one answer for a taken email AND a taken username, so the
 * registration form can't be used to tell which one exists (product
 * decision; the app sends the user back to the email step with both fields
 * marked).
 */
export const ACCOUNT_TAKEN = 'Email or username already in use';

/**
 * A real bcrypt hash (cost 10, same as every account) of a random value
 * nobody knows. Login compares against it when the email has no account, so
 * that answer takes as long as a wrong password does (AUDIT M3: ~5 ms vs
 * ~66 ms gave existing emails away). It never matches.
 */
const DUMMY_PASSWORD_HASH =
  '$2b$10$nluyx3e.EXNDYzTKuYlJaeshkE4PhEKkt1HL8X3uP.HkJUSjAdwJG';

@Injectable()
export class AuthService implements OnModuleInit {
  constructor(
    private jwtService: JwtService,
    private configService: ConfigService,
    private dataSource: DataSource,
    @InjectRepository(User)
    private userRepo: Repository<User>,
    private refreshTokens: RefreshTokensService,
  ) {}

  /** Fail the boot, not the first sign-up, if the password list is missing. */
  onModuleInit() {
    getCommonPasswords();
  }

  async login(loginDto: LoginDto) {
    const { email, password } = loginDto;

    const user = await this.userRepo.findOne({ where: { email } });
    // Always exactly one bcrypt comparison, account or not (see DUMMY_PASSWORD_HASH).
    const isMatch = await bcrypt.compare(
      password,
      user?.password_hash ?? DUMMY_PASSWORD_HASH,
    );
    if (!user || !isMatch) throw new UnauthorizedException(INVALID_CREDENTIALS);

    // Bloque 1 — a banned account (UsersService.banUser, admin-only) cannot log back
    // in. Real effect this gives the ban button: it was previously purely cosmetic —
    // is_active existed (and already gated a banned user's public profile/search
    // visibility) but nothing checked it here, so a banned user could keep logging in
    // freely. An already-issued token from before the ban still works until it expires
    // — see UsersService.banUser's own doc comment for why that's an accepted gap here.
    // B4: only reached with the right password, so this message never tells
    // a stranger that an email has an account.
    if (!user.is_active) {
      throw new UnauthorizedException('This account has been deactivated');
    }

    return this.startSession(user);
  }

  async register(registerDto: RegisterDto) {
    const { email, password, username } = registerDto;

    // Hashed first: a taken email/username must not answer faster than a
    // free one just because it skipped bcrypt (M3).
    const password_hash = await bcrypt.hash(password, 10);

    const existing = await this.userRepo.findOne({
      where: [{ email }, { username }],
    });
    if (existing) throw new ConflictException(ACCOUNT_TAKEN);

    const user = await this.createUserTransaction(
      email,
      username,
      password_hash,
    );

    return {
      message: 'User registered successfully',
      ...(await this.startSession(user)),
    };
  }

  /**
   * POST /auth/refresh: rotates the refresh token and signs a new access
   * token for the same session. Every failure is the same 401.
   */
  async refresh(refreshToken: string) {
    const { userId, issued } = await this.refreshTokens.rotate(refreshToken);
    const user = await this.userRepo.findOne({ where: { id: userId } });
    // rotate() already checked the account; this only covers a row deleted in between.
    if (!user) throw new UnauthorizedException('Invalid refresh token');
    return {
      accessToken: await this.signAccessToken(user, issued.familyId),
      refreshToken: issued.refreshToken,
      user: { id: user.id, email: user.email, username: user.username },
    };
  }

  /**
   * POST /auth/logout: revokes the session the refresh token belongs to.
   * Same answer whether or not there was anything to revoke (a 7-day token
   * from before B4 has no refresh token, and logging out twice is fine).
   */
  async logout(refreshToken: string | undefined): Promise<void> {
    if (refreshToken) await this.refreshTokens.revokeByToken(refreshToken);
  }

  /** Login/registration response: a new session (refresh family) and its first tokens. */
  private async startSession(user: User) {
    const issued = await this.refreshTokens.issue(user.id);
    return {
      accessToken: await this.signAccessToken(user, issued.familyId),
      refreshToken: issued.refreshToken,
      user: { id: user.id, email: user.email, username: user.username },
    };
  }

  /**
   * Creates the account and its profile. Two sign-ups racing for the same email or username
   * both pass the pre-check and the loser hits the unique index: that is a 409, not a 500.
   */
  private async createUserTransaction(
    email: string,
    username: string,
    password_hash: string,
  ): Promise<User> {
    try {
      return await this.runCreateUser(email, username, password_hash);
    } catch (err) {
      const driver = err as {
        driverError?: { code?: string };
        code?: string;
      };
      const code = driver.driverError?.code ?? driver.code;
      // Same answer for either index (ACCOUNT_TAKEN).
      if (code === '23505') throw new ConflictException(ACCOUNT_TAKEN);
      throw err;
    }
  }

  private async runCreateUser(
    email: string,
    username: string,
    password_hash: string,
  ): Promise<User> {
    return this.dataSource.transaction(async (manager) => {
      // DTO validation already guarantees both flags are true; the timestamp
      // is what actually gets recorded as the consent trail.
      const acceptedAt = new Date();
      const newUser = manager.create(User, {
        email,
        username,
        password_hash,
        terms_accepted_at: acceptedAt,
        terms_version: CURRENT_TERMS_VERSION,
        age_confirmed_at: acceptedAt,
      });
      const savedUser = await manager.save(newUser);

      const profile = manager.create(UserProfile, {
        user_id: savedUser.id,
        display_name: username,
        preferred_language: 'es',
      });
      await manager.save(profile);

      return savedUser;
    });
  }

  /**
   * For accounts created before T&C acceptance existed (or when the terms
   * version changes): records consent for the authenticated user.
   */
  async acceptTerms(userId: string) {
    const acceptedAt = new Date();
    const result = await this.userRepo.update(
      { id: userId, is_active: true },
      {
        terms_accepted_at: acceptedAt,
        terms_version: CURRENT_TERMS_VERSION,
        age_confirmed_at: acceptedAt,
      },
    );
    if (!result.affected) throw new UnauthorizedException('User not found');
    return {
      message: 'Terms accepted',
      terms_version: CURRENT_TERMS_VERSION,
      terms_accepted_at: acceptedAt,
    };
  }

  /** 15-minute access token; `sid` ties it to its session (JwtAuthGuard). */
  private async signAccessToken(user: User, sid: string): Promise<string> {
    return this.jwtService.signAsync(
      { sub: user.id, email: user.email, username: user.username, sid },
      {
        secret: this.configService.getOrThrow<string>('JWT_SECRET'),
        expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      },
    );
  }
}
