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
import { UserProfile } from '../users/entities/user-profile.entity';
import { WorkoutLog } from '../workout-log/entities/workout-log.entity';
import {
  getCurrentStreakDaysForUsers,
  getLoggedTodayUserIds,
} from '../workout-log/workout-log-streak.util';

// getFriendStreaks' own batching (one grouped query per data source, not one
// per followed user) is workout-log-streak.util's job and is covered by
// workout-log-streak.util.spec.ts — mocked here so this file only exercises
// FollowsService's own wiring (which users, whose streak/profile goes with
// whom). toStreakPoints is left as the real implementation since it's pure
// and its divisor is exactly what getFriendStreaks must get right.
jest.mock('../workout-log/workout-log-streak.util', () => ({
  ...jest.requireActual<
    typeof import('../workout-log/workout-log-streak.util')
  >('../workout-log/workout-log-streak.util'),
  getCurrentStreakDaysForUsers: jest.fn(),
  getLoggedTodayUserIds: jest.fn(),
}));

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

const createMockProfileRepo = () => ({
  find: jest.fn(),
});

const createMockWorkoutRepo = () => ({
  createQueryBuilder: jest.fn(),
});

describe('FollowsService', () => {
  let service: FollowsService;
  let followRepo: ReturnType<typeof createMockFollowRepo>;
  let userRepo: ReturnType<typeof createMockUserRepo>;
  let profileRepo: ReturnType<typeof createMockProfileRepo>;
  let workoutRepo: ReturnType<typeof createMockWorkoutRepo>;
  const mockGetCurrentStreakDaysForUsers =
    getCurrentStreakDaysForUsers as jest.Mock;
  const mockGetLoggedTodayUserIds = getLoggedTodayUserIds as jest.Mock;

  beforeEach(async () => {
    followRepo = createMockFollowRepo();
    userRepo = createMockUserRepo();
    profileRepo = createMockProfileRepo();
    workoutRepo = createMockWorkoutRepo();
    mockGetCurrentStreakDaysForUsers.mockReset().mockResolvedValue(new Map());
    mockGetLoggedTodayUserIds.mockReset().mockResolvedValue(new Set());

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FollowsService,
        { provide: getRepositoryToken(UserFollow), useValue: followRepo },
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: getRepositoryToken(UserProfile), useValue: profileRepo },
        { provide: getRepositoryToken(WorkoutLog), useValue: workoutRepo },
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

  describe('getFriendStreaks', () => {
    it('should return [] without querying profiles/streaks when following nobody', async () => {
      followRepo.find.mockResolvedValue([]);

      const result = await service.getFriendStreaks('user-1');

      expect(result).toEqual([]);
      expect(profileRepo.find).not.toHaveBeenCalled();
      expect(mockGetCurrentStreakDaysForUsers).not.toHaveBeenCalled();
      expect(mockGetLoggedTodayUserIds).not.toHaveBeenCalled();
    });

    it('should batch profile/streak/today lookups once for all followed users, not once per user', async () => {
      followRepo.find.mockResolvedValue([
        { followed: { id: 'user-2', username: 'alice' } },
        { followed: { id: 'user-3', username: 'bob' } },
      ]);
      profileRepo.find.mockResolvedValue([]);

      await service.getFriendStreaks('user-1');

      expect(profileRepo.find).toHaveBeenCalledTimes(1);
      expect(mockGetCurrentStreakDaysForUsers).toHaveBeenCalledTimes(1);
      expect(mockGetCurrentStreakDaysForUsers).toHaveBeenCalledWith(
        workoutRepo,
        ['user-2', 'user-3'],
      );
      expect(mockGetLoggedTodayUserIds).toHaveBeenCalledTimes(1);
      expect(mockGetLoggedTodayUserIds).toHaveBeenCalledWith(workoutRepo, [
        'user-2',
        'user-3',
      ]);
    });

    it('should map each followed user to their own avatar/streak/loggedToday, applying the /3 streak-points divisor', async () => {
      followRepo.find.mockResolvedValue([
        { followed: { id: 'user-2', username: 'alice' } },
        { followed: { id: 'user-3', username: 'bob' } },
      ]);
      profileRepo.find.mockResolvedValue([
        {
          user_id: 'user-2',
          profile_image_url: 'https://cdn.example.com/a.jpg',
        },
      ]);
      mockGetCurrentStreakDaysForUsers.mockResolvedValue(
        new Map([
          ['user-2', 7], // 7 consecutive days -> floor(7/3) = 2 streak points
          ['user-3', 2], // 2 consecutive days -> floor(2/3) = 0 streak points
        ]),
      );
      mockGetLoggedTodayUserIds.mockResolvedValue(new Set(['user-2']));

      const result = await service.getFriendStreaks('user-1');

      expect(result).toEqual([
        {
          userId: 'user-2',
          username: 'alice',
          avatarUrl: 'https://cdn.example.com/a.jpg',
          streakDays: 2,
          loggedToday: true,
        },
        {
          userId: 'user-3',
          username: 'bob',
          avatarUrl: null,
          streakDays: 0,
          loggedToday: false,
        },
      ]);
    });

    it('should default to 0 streak points and no avatar for a followed user with no workout/profile rows at all', async () => {
      followRepo.find.mockResolvedValue([
        { followed: { id: 'user-2', username: 'alice' } },
      ]);
      profileRepo.find.mockResolvedValue([]);
      // Absent from the map/set entirely, not present with a 0/false value.
      mockGetCurrentStreakDaysForUsers.mockResolvedValue(new Map());
      mockGetLoggedTodayUserIds.mockResolvedValue(new Set());

      const result = await service.getFriendStreaks('user-1');

      expect(result).toEqual([
        {
          userId: 'user-2',
          username: 'alice',
          avatarUrl: null,
          streakDays: 0,
          loggedToday: false,
        },
      ]);
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
