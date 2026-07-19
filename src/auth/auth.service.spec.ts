import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import { DataSource } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { AuthService } from './auth.service';

jest.mock('bcrypt', () => ({
  compare: jest.fn(),
  hash: jest.fn(),
}));

describe('AuthService', () => {
  let service: AuthService;
  let userRepo: { findOne: jest.Mock };
  let jwtService: { signAsync: jest.Mock };
  let configService: { getOrThrow: jest.Mock };

  beforeEach(async () => {
    userRepo = { findOne: jest.fn() };
    jwtService = { signAsync: jest.fn() };
    configService = { getOrThrow: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: JwtService, useValue: jwtService },
        { provide: ConfigService, useValue: configService },
        { provide: DataSource, useValue: { transaction: jest.fn() } },
      ],
    }).compile();

    service = module.get(AuthService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('returns a token and the public user fields for valid credentials', async () => {
    const user = {
      id: 'user-1',
      email: 'user@example.com',
      username: 'havit-user',
      password_hash: 'stored-hash',
      is_active: true,
    } as User;
    userRepo.findOne.mockResolvedValue(user);
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);
    configService.getOrThrow.mockReturnValue('test-secret');
    jwtService.signAsync.mockResolvedValue('signed-token');

    await expect(
      service.login({ email: user.email, password: 'password123' }),
    ).resolves.toEqual({
      accessToken: 'signed-token',
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
      },
    });

    expect(bcrypt.compare).toHaveBeenCalledWith('password123', 'stored-hash');
    expect(jwtService.signAsync).toHaveBeenCalledWith(
      { sub: user.id, email: user.email, username: user.username },
      { secret: 'test-secret', expiresIn: '7d' },
    );
  });

  it('rejects an unknown email without comparing a password', async () => {
    userRepo.findOne.mockResolvedValue(null);

    await expect(
      service.login({ email: 'missing@example.com', password: 'password123' }),
    ).rejects.toThrow(UnauthorizedException);

    expect(bcrypt.compare).not.toHaveBeenCalled();
    expect(jwtService.signAsync).not.toHaveBeenCalled();
  });
});
