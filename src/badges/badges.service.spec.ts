import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { BadgesService } from './badges.service';
import { WorkoutLog } from '../workout-log/entities/workout-log.entity';
import { ChallengeUserMap } from '../challenges/entities/challenge-user-map.entity';
import { User } from '../users/entities/user.entity';
import { UserProfile } from '../users/entities/user-profile.entity';
import { FollowsService } from '../follows/follows.service';

const createMockWorkoutRepo = () => ({
  count: jest.fn(),
  createQueryBuilder: jest.fn(),
});

const createMockRepo = () => ({
  count: jest.fn(),
  findOne: jest.fn(),
});

describe('BadgesService', () => {
  let service: BadgesService;
  let workoutRepo: ReturnType<typeof createMockWorkoutRepo>;
  let challengeUserRepo: ReturnType<typeof createMockRepo>;
  let userRepo: ReturnType<typeof createMockRepo>;
  let profileRepo: ReturnType<typeof createMockRepo>;
  let followsService: { isActiveFollower: jest.Mock };

  const USER_ID = 'user-1';
  const OTHER_USER_ID = 'user-2';

  function mockStreakDays(days: string[]) {
    workoutRepo.createQueryBuilder.mockReturnValue({
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue(days.map((day) => ({ day }))),
    });
  }

  beforeEach(async () => {
    workoutRepo = createMockWorkoutRepo();
    challengeUserRepo = createMockRepo();
    userRepo = createMockRepo();
    profileRepo = createMockRepo();
    followsService = { isActiveFollower: jest.fn().mockResolvedValue(false) };

    workoutRepo.count.mockResolvedValue(0);
    challengeUserRepo.count.mockResolvedValue(0);
    mockStreakDays([]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BadgesService,
        { provide: getRepositoryToken(WorkoutLog), useValue: workoutRepo },
        {
          provide: getRepositoryToken(ChallengeUserMap),
          useValue: challengeUserRepo,
        },
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: getRepositoryToken(UserProfile), useValue: profileRepo },
        { provide: FollowsService, useValue: followsService },
      ],
    }).compile();

    service = module.get(BadgesService);
  });

  describe('getMyBadges', () => {
    it('should return the full catalog, all unearned, when the user has no activity', async () => {
      const badges = await service.getMyBadges(USER_ID);

      expect(badges).toHaveLength(6);
      expect(badges.every((b) => !b.earned)).toBe(true);
      expect(badges.find((b) => b.code === 'first_workout')).toMatchObject({
        progress: 0,
        target: 1,
      });
    });

    it('should mark workout-count badges earned/unearned by threshold and cap progress at target', async () => {
      workoutRepo.count.mockResolvedValue(7);

      const badges = await service.getMyBadges(USER_ID);

      expect(badges.find((b) => b.code === 'first_workout')).toMatchObject({
        earned: true,
        progress: 1,
        target: 1,
      });
      expect(badges.find((b) => b.code === 'five_workouts')).toMatchObject({
        earned: true,
        progress: 5,
        target: 5,
      });
      expect(badges.find((b) => b.code === 'ten_workouts')).toMatchObject({
        earned: false,
        progress: 7,
        target: 10,
      });
    });

    it('should mark challenge-completion badges from ChallengeUserMap completed count', async () => {
      challengeUserRepo.count.mockResolvedValue(2);

      const badges = await service.getMyBadges(USER_ID);

      expect(
        badges.find((b) => b.code === 'one_challenge_completed'),
      ).toMatchObject({ earned: true, progress: 1, target: 1 });
      expect(
        badges.find((b) => b.code === 'three_challenges_completed'),
      ).toMatchObject({ earned: false, progress: 2, target: 3 });
      expect(challengeUserRepo.count).toHaveBeenCalledWith({
        where: { user_id: USER_ID, status: 'completed' },
      });
    });

    it('should compute the current streak from consecutive completed days ending today', async () => {
      const today = new Date();
      const dayKey = (offset: number) => {
        const d = new Date(today);
        d.setUTCDate(d.getUTCDate() - offset);
        return d.toISOString().slice(0, 10);
      };
      mockStreakDays([dayKey(0), dayKey(1), dayKey(2)]);

      const badges = await service.getMyBadges(USER_ID);

      expect(badges.find((b) => b.code === 'streak_7_days')).toMatchObject({
        earned: false,
        progress: 3,
        target: 7,
      });
    });

    it('should tolerate today not having a completed workout yet without dropping the streak to zero', async () => {
      const today = new Date();
      const dayKey = (offset: number) => {
        const d = new Date(today);
        d.setUTCDate(d.getUTCDate() - offset);
        return d.toISOString().slice(0, 10);
      };
      // Yesterday and the day before, but not today.
      mockStreakDays([dayKey(1), dayKey(2)]);

      const badges = await service.getMyBadges(USER_ID);

      expect(badges.find((b) => b.code === 'streak_7_days')?.progress).toBe(2);
    });
  });

  describe('getUserBadges', () => {
    it('should throw NotFoundException for an unknown or inactive user', async () => {
      userRepo.findOne.mockResolvedValue(null);

      await expect(
        service.getUserBadges(OTHER_USER_ID, USER_ID),
      ).rejects.toThrow(NotFoundException);
    });

    it('should return the full list for a public profile without checking follow status', async () => {
      userRepo.findOne.mockResolvedValue({ id: OTHER_USER_ID });
      profileRepo.findOne.mockResolvedValue({ is_private: false });
      workoutRepo.count.mockResolvedValue(1);

      const badges = await service.getUserBadges(OTHER_USER_ID, USER_ID);

      expect(badges.find((b) => b.code === 'first_workout')?.earned).toBe(true);
      expect(followsService.isActiveFollower).not.toHaveBeenCalled();
    });

    it('should return [] for a private profile when the viewer is not an active follower', async () => {
      userRepo.findOne.mockResolvedValue({ id: OTHER_USER_ID });
      profileRepo.findOne.mockResolvedValue({ is_private: true });
      followsService.isActiveFollower.mockResolvedValue(false);

      const badges = await service.getUserBadges(OTHER_USER_ID, USER_ID);

      expect(badges).toEqual([]);
    });

    it('should return the full list for a private profile when the viewer actively follows the target', async () => {
      userRepo.findOne.mockResolvedValue({ id: OTHER_USER_ID });
      profileRepo.findOne.mockResolvedValue({ is_private: true });
      followsService.isActiveFollower.mockResolvedValue(true);
      workoutRepo.count.mockResolvedValue(1);

      const badges = await service.getUserBadges(OTHER_USER_ID, USER_ID);

      expect(badges.find((b) => b.code === 'first_workout')?.earned).toBe(true);
      expect(followsService.isActiveFollower).toHaveBeenCalledWith(
        USER_ID,
        OTHER_USER_ID,
      );
    });

    it('should return the full list for the owner without checking follow status, even on a private profile', async () => {
      userRepo.findOne.mockResolvedValue({ id: USER_ID });
      profileRepo.findOne.mockResolvedValue({ is_private: true });
      workoutRepo.count.mockResolvedValue(1);

      const badges = await service.getUserBadges(USER_ID, USER_ID);

      expect(badges.find((b) => b.code === 'first_workout')?.earned).toBe(true);
      expect(followsService.isActiveFollower).not.toHaveBeenCalled();
    });
  });
});
