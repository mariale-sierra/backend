import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { FollowsService } from './follows.service';
import { UserFollow } from './entities/user-follow.entity';
import { User } from '../users/entities/user.entity';

const createMockFollowRepo = () => ({
  findOne: jest.fn(),
  find: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  count: jest.fn(),
  createQueryBuilder: jest.fn(),
});

const createMockUserRepo = () => ({
  findOne: jest.fn(),
});

describe('FollowsService', () => {
  let service: FollowsService;
  let followRepo: ReturnType<typeof createMockFollowRepo>;
  let userRepo: ReturnType<typeof createMockUserRepo>;

  beforeEach(async () => {
    followRepo = createMockFollowRepo();
    userRepo = createMockUserRepo();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FollowsService,
        { provide: getRepositoryToken(UserFollow), useValue: followRepo },
        { provide: getRepositoryToken(User), useValue: userRepo },
      ],
    }).compile();

    service = module.get(FollowsService);
  });

  describe('follow', () => {
    it('should reject following yourself before hitting the database', async () => {
      await expect(service.follow('user-1', 'user-1')).rejects.toThrow(
        BadRequestException,
      );
      expect(userRepo.findOne).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException when the target user does not exist or is inactive', async () => {
      userRepo.findOne.mockResolvedValue(null);

      await expect(service.follow('user-1', 'user-2')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw ConflictException when already actively following', async () => {
      userRepo.findOne.mockResolvedValue({ id: 'user-2' });
      followRepo.findOne.mockResolvedValue({
        follower_user_id: 'user-1',
        followed_user_id: 'user-2',
        is_active: true,
      });

      await expect(service.follow('user-1', 'user-2')).rejects.toThrow(
        ConflictException,
      );
      expect(followRepo.save).not.toHaveBeenCalled();
    });

    it('should reactivate an inactive (previously-unfollowed) row instead of inserting a duplicate', async () => {
      userRepo.findOne.mockResolvedValue({ id: 'user-2' });
      const existing = {
        follower_user_id: 'user-1',
        followed_user_id: 'user-2',
        is_active: false,
      };
      followRepo.findOne.mockResolvedValue(existing);
      followRepo.save.mockResolvedValue(existing);

      await service.follow('user-1', 'user-2');

      expect(followRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ is_active: true }),
      );
      expect(followRepo.create).not.toHaveBeenCalled();
    });

    it('should create a new follow row when none exists', async () => {
      userRepo.findOne.mockResolvedValue({ id: 'user-2' });
      followRepo.findOne.mockResolvedValue(null);
      followRepo.create.mockReturnValue({
        follower_user_id: 'user-1',
        followed_user_id: 'user-2',
        is_active: true,
      });
      followRepo.save.mockResolvedValue({});

      const result = await service.follow('user-1', 'user-2');

      expect(followRepo.create).toHaveBeenCalledWith({
        follower_user_id: 'user-1',
        followed_user_id: 'user-2',
        is_active: true,
      });
      expect(result).toEqual({ message: 'Now following user' });
    });

    it('should translate a DB-level unique-violation race (23505) into a 409, not a 500', async () => {
      userRepo.findOne.mockResolvedValue({ id: 'user-2' });
      followRepo.findOne.mockResolvedValue(null);
      followRepo.create.mockReturnValue({});
      followRepo.save.mockRejectedValue({ code: '23505' });

      await expect(service.follow('user-1', 'user-2')).rejects.toThrow(
        ConflictException,
      );
    });

    it('should rethrow unrelated database errors as-is', async () => {
      userRepo.findOne.mockResolvedValue({ id: 'user-2' });
      followRepo.findOne.mockResolvedValue(null);
      followRepo.create.mockReturnValue({});
      const dbError = new Error('connection lost');
      followRepo.save.mockRejectedValue(dbError);

      await expect(service.follow('user-1', 'user-2')).rejects.toBe(dbError);
    });
  });

  describe('unfollow', () => {
    it('should soft-delete an active follow (is_active = false), not remove the row', async () => {
      const existing = {
        follower_user_id: 'user-1',
        followed_user_id: 'user-2',
        is_active: true,
      };
      followRepo.findOne.mockResolvedValue(existing);
      followRepo.save.mockResolvedValue(existing);

      await service.unfollow('user-1', 'user-2');

      expect(followRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ is_active: false }),
      );
    });

    it('should throw NotFoundException when there is no active follow to remove', async () => {
      followRepo.findOne.mockResolvedValue(null);

      await expect(service.unfollow('user-1', 'user-2')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('listFollowers / listFollowing', () => {
    it('should map follower rows to the safe public summary shape', async () => {
      followRepo.find.mockResolvedValue([
        {
          created_at: new Date('2026-01-01T00:00:00.000Z'),
          follower: { id: 'user-3', username: 'carol' },
        },
      ]);

      const result = await service.listFollowers('user-1');

      expect(followRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { followed_user_id: 'user-1', is_active: true },
        }),
      );
      expect(result).toEqual([
        {
          id: 'user-3',
          username: 'carol',
          followed_at: new Date('2026-01-01T00:00:00.000Z'),
        },
      ]);
    });

    it('should map following rows to the safe public summary shape', async () => {
      followRepo.find.mockResolvedValue([
        {
          created_at: new Date('2026-01-02T00:00:00.000Z'),
          followed: { id: 'user-4', username: 'dave' },
        },
      ]);

      const result = await service.listFollowing('user-1');

      expect(followRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { follower_user_id: 'user-1', is_active: true },
        }),
      );
      expect(result[0]).toMatchObject({ id: 'user-4', username: 'dave' });
    });
  });

  describe('getCounts', () => {
    it('should count active followers and active following independently', async () => {
      followRepo.count.mockResolvedValueOnce(7).mockResolvedValueOnce(2);

      const result = await service.getCounts('user-1');

      expect(followRepo.count).toHaveBeenNthCalledWith(1, {
        where: { followed_user_id: 'user-1', is_active: true },
      });
      expect(followRepo.count).toHaveBeenNthCalledWith(2, {
        where: { follower_user_id: 'user-1', is_active: true },
      });
      expect(result).toEqual({ followersCount: 7, followingCount: 2 });
    });
  });

  describe('isActiveFollower', () => {
    it('should return true only when an active follow row exists', async () => {
      followRepo.findOne.mockResolvedValue({ is_active: true });

      await expect(service.isActiveFollower('user-1', 'user-2')).resolves.toBe(
        true,
      );
    });

    it('should return false when no follow row exists', async () => {
      followRepo.findOne.mockResolvedValue(null);

      await expect(service.isActiveFollower('user-1', 'user-2')).resolves.toBe(
        false,
      );
    });
  });
});
