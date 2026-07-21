import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ChallengeUserMap } from '../challenges/entities/challenge-user-map.entity';
import { User } from './entities/user.entity';
import { UsersService } from './users.service';

const createRepositoryMock = () => ({
  findOne: jest.fn(),
  createQueryBuilder: jest.fn(),
});

const createQueryBuilderMock = () => {
  const queryBuilder = {
    leftJoinAndSelect: jest.fn(),
    where: jest.fn(),
    orderBy: jest.fn(),
    getMany: jest.fn(),
  };

  queryBuilder.leftJoinAndSelect.mockReturnValue(queryBuilder);
  queryBuilder.where.mockReturnValue(queryBuilder);
  queryBuilder.orderBy.mockReturnValue(queryBuilder);
  return queryBuilder;
};

describe('UsersService', () => {
  let service: UsersService;
  let userRepo: ReturnType<typeof createRepositoryMock>;
  let challengeUserRepo: ReturnType<typeof createRepositoryMock>;

  beforeEach(async () => {
    userRepo = createRepositoryMock();
    challengeUserRepo = createRepositoryMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getRepositoryToken(User), useValue: userRepo },
        {
          provide: getRepositoryToken(ChallengeUserMap),
          useValue: challengeUserRepo,
        },
      ],
    }).compile();

    service = module.get(UsersService);
    jest.clearAllMocks();
  });

  describe('findById', () => {
    it('returns the requested user', async () => {
      const user = { id: 'user-1', email: 'user@example.com' };
      userRepo.findOne.mockResolvedValue(user);

      await expect(service.findById('user-1')).resolves.toBe(user);
      expect(userRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'user-1' },
      });
    });

    it('throws NotFoundException when the user does not exist', async () => {
      userRepo.findOne.mockResolvedValue(null);

      const action = service.findById('missing');

      await expect(action).rejects.toBeInstanceOf(NotFoundException);
      await expect(action).rejects.toThrow('User not found');
    });

    it('propagates repository errors', async () => {
      const error = new Error('users query failed');
      userRepo.findOne.mockRejectedValue(error);

      await expect(service.findById('user-1')).rejects.toBe(error);
    });
  });

  describe('getUserChallenges', () => {
    it('queries by user and groups transformed challenges by status', async () => {
      const queryBuilder = createQueryBuilderMock();
      challengeUserRepo.createQueryBuilder.mockReturnValue(queryBuilder);
      queryBuilder.getMany.mockResolvedValue([
        {
          challenge: { id: 'active-1', title: 'Active' },
          status: 'active',
          joined_at: new Date('2026-01-01T00:00:00Z'),
        },
        {
          challenge: { id: 'complete-1', title: 'Complete' },
          status: 'completed',
          joined_at: new Date('2026-02-01T00:00:00Z'),
        },
        {
          challenge: { id: 'left-1', title: 'Left' },
          status: 'left',
          joined_at: new Date('2026-03-01T00:00:00Z'),
        },
        {
          challenge: { id: 'pending-1', title: 'Pending' },
          status: 'pending',
          joined_at: new Date('2026-04-01T00:00:00Z'),
        },
      ]);

      const result = await service.getUserChallenges('user-1');

      expect(challengeUserRepo.createQueryBuilder).toHaveBeenCalledWith('cu');
      expect(queryBuilder.leftJoinAndSelect).toHaveBeenCalledWith(
        'cu.challenge',
        'challenge',
      );
      expect(queryBuilder.where).toHaveBeenCalledWith('cu.user_id = :userId', {
        userId: 'user-1',
      });
      expect(queryBuilder.orderBy).toHaveBeenCalledWith('cu.joined_at', 'DESC');
      expect(result.active).toEqual([
        {
          id: 'active-1',
          title: 'Active',
          status: 'active',
          joinedAt: new Date('2026-01-01T00:00:00Z'),
        },
        {
          id: 'pending-1',
          title: 'Pending',
          status: 'pending',
          joinedAt: new Date('2026-04-01T00:00:00Z'),
        },
      ]);
      expect(result.completed).toEqual([
        {
          id: 'complete-1',
          title: 'Complete',
          status: 'completed',
          joinedAt: new Date('2026-02-01T00:00:00Z'),
        },
      ]);
      expect(result.left).toEqual([
        {
          id: 'left-1',
          title: 'Left',
          status: 'left',
          joinedAt: new Date('2026-03-01T00:00:00Z'),
        },
      ]);
    });

    it('returns three empty groups when the user has no challenges', async () => {
      const queryBuilder = createQueryBuilderMock();
      challengeUserRepo.createQueryBuilder.mockReturnValue(queryBuilder);
      queryBuilder.getMany.mockResolvedValue([]);

      await expect(service.getUserChallenges('user-1')).resolves.toEqual({
        active: [],
        completed: [],
        left: [],
      });
    });

    it('propagates query builder errors', async () => {
      const queryBuilder = createQueryBuilderMock();
      const error = new Error('challenge query failed');
      challengeUserRepo.createQueryBuilder.mockReturnValue(queryBuilder);
      queryBuilder.getMany.mockRejectedValue(error);

      await expect(service.getUserChallenges('user-1')).rejects.toBe(error);
    });
  });
});
