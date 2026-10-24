import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import * as bcrypt from 'bcrypt';
import {
  ACCOUNT_TAKEN,
  AuthService,
  CURRENT_TERMS_VERSION,
  INVALID_CREDENTIALS,
} from './auth.service';
import { User } from '../users/entities/user.entity';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  RefreshTokensService,
} from './refresh-tokens.service';

jest.mock('bcrypt', () => ({
  hash: jest.fn(),
  compare: jest.fn(),
}));

const createMockRepo = () => ({
  findOne: jest.fn(),
});

describe('AuthService', () => {
  let service: AuthService;
  let userRepo: ReturnType<typeof createMockRepo> & { update: jest.Mock };
  let jwtService: { signAsync: jest.Mock };
  let configService: { getOrThrow: jest.Mock };
  let dataSource: { transaction: jest.Mock };
  let refreshTokens: {
    issue: jest.Mock;
    rotate: jest.Mock;
    revokeByToken: jest.Mock;
  };

  beforeEach(async () => {
    userRepo = { ...createMockRepo(), update: jest.fn() };
    jwtService = { signAsync: jest.fn().mockResolvedValue('signed.jwt.token') };
    configService = { getOrThrow: jest.fn().mockReturnValue('test-secret') };
    dataSource = { transaction: jest.fn() };

    jest.clearAllMocks();
    refreshTokens = {
      issue: jest.fn().mockResolvedValue({
        id: 'rt-1',
        refreshToken: 'opaque-refresh',
        familyId: 'family-1',
        expiresAt: new Date(),
      }),
      rotate: jest.fn(),
      revokeByToken: jest.fn().mockResolvedValue(null),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: JwtService, useValue: jwtService },
        { provide: ConfigService, useValue: configService },
        { provide: DataSource, useValue: dataSource },
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: RefreshTokensService, useValue: refreshTokens },
      ],
    }).compile();

    service = module.get(AuthService);
  });

  describe('register', () => {
    it('should hash the password before storing the new user', async () => {
      userRepo.findOne.mockResolvedValue(null); // no existing user with that email
      (bcrypt.hash as jest.Mock).mockResolvedValue('hashed-password-value');

      const savedUser = {
        id: 'new-user-1',
        email: 'new@example.com',
        username: 'newuser',
        password_hash: 'hashed-password-value',
      };
      dataSource.transaction.mockImplementation(async (cb) =>
        cb({
          create: jest.fn().mockImplementation((_entity, data) => data),
          save: jest
            .fn()
            .mockImplementation((data) =>
              Promise.resolve(data.password_hash ? savedUser : data),
            ),
        }),
      );

      const result = await service.register({
        email: 'new@example.com',
        username: 'newuser',
        password: 'plaintext-password',
        acceptTerms: true,
        confirmAge16: true,
      });

      expect(bcrypt.hash).toHaveBeenCalledWith('plaintext-password', 10);
      expect(result.accessToken).toBe('signed.jwt.token');
      // B4: registering also opens a session (refresh family) for the new user.
      expect(refreshTokens.issue).toHaveBeenCalledWith('new-user-1');
      expect(result.refreshToken).toBe('opaque-refresh');
      expect(result.user).toEqual({
        id: 'new-user-1',
        email: 'new@example.com',
        username: 'newuser',
      });
      // The plaintext password must never leak into the returned payload.
      expect(JSON.stringify(result)).not.toContain('plaintext-password');
    });

    it('should record when the terms were accepted, which version, and the 16+ confirmation', async () => {
      userRepo.findOne.mockResolvedValue(null);
      (bcrypt.hash as jest.Mock).mockResolvedValue('h');
      const create = jest.fn().mockImplementation((_entity, data) => data);
      dataSource.transaction.mockImplementation(async (cb) =>
        cb({
          create,
          save: jest.fn().mockImplementation((d) =>
            Promise.resolve({
              id: 'u1',
              email: 'a@b.com',
              username: 'ab',
              ...d,
            }),
          ),
        }),
      );

      await service.register({
        email: 'a@b.com',
        username: 'ab',
        password: 'password123',
        acceptTerms: true,
        confirmAge16: true,
      });

      const userData = create.mock.calls[0][1];
      expect(userData.terms_accepted_at).toBeInstanceOf(Date);
      expect(userData.terms_version).toBe(CURRENT_TERMS_VERSION);
      expect(userData.age_confirmed_at).toBeInstanceOf(Date);
    });

    it('should reject registration when the email is already in use', async () => {
      userRepo.findOne.mockResolvedValue({
        id: 'existing-user',
        email: 'taken@example.com',
      });

      await expect(
        service.register({
          email: 'taken@example.com',
          username: 'someone',
          password: 'whatever',
          acceptTerms: true,
          confirmAge16: true,
        }),
      ).rejects.toThrow(ConflictException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
      expect(refreshTokens.issue).not.toHaveBeenCalled();
    });

    // B4 / M3: the same status and message whichever of the two is taken.
    it.each([
      ['email', { id: 'u', email: 'taken@example.com', username: 'other' }],
      [
        'username',
        { id: 'u', email: 'other@example.com', username: 'someone' },
      ],
    ])(
      'answers the same 409 when the %s is taken',
      async (_field, existing) => {
        userRepo.findOne.mockResolvedValue(existing);
        (bcrypt.hash as jest.Mock).mockResolvedValue('h');
        await expect(
          service.register({
            email: 'taken@example.com',
            username: 'someone',
            password: 'whatever12',
            acceptTerms: true,
            confirmAge16: true,
          }),
        ).rejects.toMatchObject({ message: ACCOUNT_TAKEN, status: 409 });
        expect(userRepo.findOne).toHaveBeenCalledWith({
          where: [{ email: 'taken@example.com' }, { username: 'someone' }],
        });
      },
    );

    it('hashes the password even when the account is taken (no timing difference)', async () => {
      userRepo.findOne.mockResolvedValue({ id: 'existing-user' });
      (bcrypt.hash as jest.Mock).mockResolvedValue('h');
      await service
        .register({
          email: 'taken@example.com',
          username: 'someone',
          password: 'whatever12',
          acceptTerms: true,
          confirmAge16: true,
        })
        .catch(() => undefined);
      expect(bcrypt.hash).toHaveBeenCalledTimes(1);
    });

    // Two sign-ups racing for the same address both pass the pre-check; the loser hits the
    // unique index and used to surface as a 500.
    it.each([
      ['email', 'Key (email)=(a@b.co) already exists.', ACCOUNT_TAKEN],
      ['username', 'Key (username)=(ana) already exists.', ACCOUNT_TAKEN],
    ])(
      'answers 409 when the %s unique index loses a race',
      async (_field, detail, message) => {
        userRepo.findOne.mockResolvedValue(null);
        (bcrypt.hash as jest.Mock).mockResolvedValue('h');
        dataSource.transaction.mockRejectedValue({
          driverError: { code: '23505', detail },
        });

        await expect(
          service.register({
            email: 'a@b.co',
            username: 'ana',
            password: 'whatever12',
            acceptTerms: true,
            confirmAge16: true,
          }),
        ).rejects.toMatchObject({ message, status: 409 });
      },
    );

    it('still lets unrelated database errors through as 500s', async () => {
      userRepo.findOne.mockResolvedValue(null);
      (bcrypt.hash as jest.Mock).mockResolvedValue('h');
      dataSource.transaction.mockRejectedValue(new Error('connection lost'));
      await expect(
        service.register({
          email: 'a@b.co',
          username: 'ana',
          password: 'whatever12',
          acceptTerms: true,
          confirmAge16: true,
        }),
      ).rejects.toThrow('connection lost');
    });
  });

  describe('acceptTerms', () => {
    it('records acceptance time, version and age confirmation for the user', async () => {
      userRepo.update.mockResolvedValue({ affected: 1 });

      const res = await service.acceptTerms('user-1');

      expect(userRepo.update).toHaveBeenCalledWith(
        { id: 'user-1', is_active: true },
        expect.objectContaining({
          terms_version: CURRENT_TERMS_VERSION,
          terms_accepted_at: expect.any(Date),
          age_confirmed_at: expect.any(Date),
        }),
      );
      expect(res.terms_version).toBe(CURRENT_TERMS_VERSION);
    });

    it('rejects when the user does not exist or is inactive', async () => {
      userRepo.update.mockResolvedValue({ affected: 0 });
      await expect(service.acceptTerms('ghost')).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('login', () => {
    it('should reject login when the email does not exist', async () => {
      userRepo.findOne.mockResolvedValue(null);

      await expect(
        service.login({ email: 'nobody@example.com', password: 'whatever' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    // B4 / AUDIT M3: without a comparison, an unknown email answered in ~5 ms
    // vs ~66 ms for a known one.
    it('still runs one bcrypt comparison when the email does not exist', async () => {
      userRepo.findOne.mockResolvedValue(null);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await service
        .login({ email: 'nobody@example.com', password: 'whatever' })
        .catch(() => undefined);

      expect(bcrypt.compare).toHaveBeenCalledTimes(1);
      const [, hash] = (bcrypt.compare as jest.Mock).mock.calls[0];
      expect(hash).toMatch(/^\$2b\$10\$.{53}$/);
    });

    it('answers an unknown email and a wrong password identically', async () => {
      userRepo.findOne.mockResolvedValueOnce(null);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);
      const unknown = await service
        .login({ email: 'nobody@example.com', password: 'whatever' })
        .catch((e: UnauthorizedException) => e);

      userRepo.findOne.mockResolvedValueOnce({
        id: 'user-1',
        email: 'a@example.com',
        password_hash: 'hashed-value',
        is_active: true,
      });
      const wrong = await service
        .login({ email: 'a@example.com', password: 'whatever' })
        .catch((e: UnauthorizedException) => e);

      expect(unknown).toBeInstanceOf(UnauthorizedException);
      expect(wrong).toBeInstanceOf(UnauthorizedException);
      expect((unknown as UnauthorizedException).getResponse()).toEqual(
        (wrong as UnauthorizedException).getResponse(),
      );
      expect((unknown as Error).message).toBe(INVALID_CREDENTIALS);
    });

    it('does not reveal a deactivated account behind a wrong password', async () => {
      userRepo.findOne.mockResolvedValue({
        id: 'user-1',
        email: 'banned@example.com',
        password_hash: 'hashed-value',
        is_active: false,
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(
        service.login({ email: 'banned@example.com', password: 'nope' }),
      ).rejects.toThrow(INVALID_CREDENTIALS);
    });

    it('should reject login when the password does not match', async () => {
      userRepo.findOne.mockResolvedValue({
        id: 'user-1',
        email: 'a@example.com',
        username: 'a',
        password_hash: 'hashed-value',
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(
        service.login({ email: 'a@example.com', password: 'wrong-password' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should issue a 15-minute JWT with sub/email/username/sid and a refresh token on successful login', async () => {
      const user = {
        id: 'user-1',
        email: 'a@example.com',
        username: 'a',
        password_hash: 'hashed-value',
        is_active: true,
      };
      userRepo.findOne.mockResolvedValue(user);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      const result = await service.login({
        email: 'a@example.com',
        password: 'correct-password',
      });

      expect(refreshTokens.issue).toHaveBeenCalledWith('user-1');
      expect(jwtService.signAsync).toHaveBeenCalledWith(
        {
          sub: user.id,
          email: user.email,
          username: user.username,
          sid: 'family-1',
        },
        expect.objectContaining({
          secret: 'test-secret',
          expiresIn: ACCESS_TOKEN_TTL_SECONDS,
        }),
      );
      expect(ACCESS_TOKEN_TTL_SECONDS).toBe(15 * 60);
      expect(result).toEqual({
        accessToken: 'signed.jwt.token',
        refreshToken: 'opaque-refresh',
        user: { id: 'user-1', email: 'a@example.com', username: 'a' },
      });
    });

    // Bloque 1: UsersService.banUser deactivates via the same is_active flag — this is
    // what actually makes that ban have an effect (see AuthService.login's own comment).
    it('should reject login for a banned (is_active=false) account, even with the correct password', async () => {
      userRepo.findOne.mockResolvedValue({
        id: 'user-1',
        email: 'banned@example.com',
        username: 'banned',
        password_hash: 'hashed-value',
        is_active: false,
      });
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);

      await expect(
        service.login({
          email: 'banned@example.com',
          password: 'correct-password',
        }),
      ).rejects.toThrow('This account has been deactivated');
      expect(jwtService.signAsync).not.toHaveBeenCalled();
      expect(refreshTokens.issue).not.toHaveBeenCalled();
    });
  });

  describe('refresh', () => {
    it('signs a new access token for the same session with the rotated refresh token', async () => {
      refreshTokens.rotate.mockResolvedValue({
        userId: 'user-1',
        issued: {
          refreshToken: 'next-refresh',
          familyId: 'family-1',
          expiresAt: new Date(),
        },
      });
      userRepo.findOne.mockResolvedValue({
        id: 'user-1',
        email: 'a@example.com',
        username: 'a',
      });

      const result = await service.refresh('old-refresh');

      expect(refreshTokens.rotate).toHaveBeenCalledWith('old-refresh');
      expect(jwtService.signAsync).toHaveBeenCalledWith(
        expect.objectContaining({ sub: 'user-1', sid: 'family-1' }),
        expect.objectContaining({ expiresIn: ACCESS_TOKEN_TTL_SECONDS }),
      );
      expect(result.refreshToken).toBe('next-refresh');
      expect(result.accessToken).toBe('signed.jwt.token');
    });

    it('lets the rotation 401 through and signs nothing', async () => {
      refreshTokens.rotate.mockRejectedValue(
        new UnauthorizedException('Invalid refresh token'),
      );
      await expect(service.refresh('reused')).rejects.toThrow(
        'Invalid refresh token',
      );
      expect(jwtService.signAsync).not.toHaveBeenCalled();
    });
  });

  describe('logout', () => {
    it('revokes the session of the refresh token', async () => {
      await service.logout('refresh-1');
      expect(refreshTokens.revokeByToken).toHaveBeenCalledWith('refresh-1');
    });

    it('is a no-op without a refresh token (7-day tokens from before B4)', async () => {
      await expect(service.logout(undefined)).resolves.toBeUndefined();
      expect(refreshTokens.revokeByToken).not.toHaveBeenCalled();
    });
  });
});
