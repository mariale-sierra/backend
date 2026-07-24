import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { UsersService } from './users.service';
import { User } from './entities/user.entity';
import { ChallengeUserMap } from '../challenges/entities/challenge-user-map.entity';

const createMockRepo = () => ({
  findOne: jest.fn(),
  createQueryBuilder: jest.fn(),
});

describe('UsersService', () => {
  let service: UsersService;
  let userRepo: ReturnType<typeof createMockRepo>;

  beforeEach(async () => {
    userRepo = createMockRepo();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: getRepositoryToken(ChallengeUserMap), useValue: createMockRepo() },
      ],
    }).compile();

    service = module.get(UsersService);
  });

  describe('findById', () => {
    it('should never include password_hash in the response, even if the repository returned it', async () => {
      // Simulate a misconfigured `select` accidentally leaking the hash —
      // the DTO mapping must still strip it.
      userRepo.findOne.mockResolvedValue({
        id: 'user-1',
        username: 'alice',
        email: 'alice@example.com',
        is_active: true,
        password_hash: '$2b$10$leakedhashvalue',
      });

      const result = await service.findById('user-1');

      expect(result).not.toHaveProperty('password_hash');
      expect(JSON.stringify(result)).not.toContain('leakedhash');
      expect(result).toEqual({
        id: 'user-1',
        username: 'alice',
        email: 'alice@example.com',
        is_active: true,
      });
    });

    it('should query with an explicit select that excludes password_hash', async () => {
      userRepo.findOne.mockResolvedValue({
        id: 'user-1',
        username: 'alice',
        email: 'alice@example.com',
        is_active: true,
      });

      await service.findById('user-1');

      expect(userRepo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          select: expect.not.arrayContaining(['password_hash']),
        }),
      );
    });

    it('should throw NotFoundException when the user does not exist', async () => {
      userRepo.findOne.mockResolvedValue(null);

      await expect(service.findById('missing-id')).rejects.toThrow(NotFoundException);
    });
  });
});
