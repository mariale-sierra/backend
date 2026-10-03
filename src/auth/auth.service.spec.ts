import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { AuthService, CURRENT_TERMS_VERSION } from './auth.service';
import { User } from '../users/entities/user.entity';

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

  beforeEach(async () => {
    userRepo = { ...createMockRepo(), update: jest.fn() };
    jwtService = { signAsync: jest.fn().mockResolvedValue('signed.jwt.token') };
    configService = { getOrThrow: jest.fn().mockReturnValue('test-secret') };
    dataSource = { transaction: jest.fn() };

    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: JwtService, useValue: jwtService },
        { provide: ConfigService, useValue: configService },
        { provide: DataSource, useValue: dataSource },
        { provide: getRepositoryToken(User), useValue: userRepo },
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

    it('should issue a JWT containing sub/email/username on successful login', async () => {
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

      expect(jwtService.signAsync).toHaveBeenCalledWith(
        { sub: user.id, email: user.email, username: user.username },
        expect.objectContaining({ secret: 'test-secret', expiresIn: '7d' }),
      );
      expect(result.accessToken).toBe('signed.jwt.token');
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
      ).rejects.toThrow(UnauthorizedException);
      expect(jwtService.signAsync).not.toHaveBeenCalled();
    });
  });
});
