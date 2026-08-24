import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotFoundException } from '@nestjs/common';
import { UsersService } from './users.service';
import { User } from './entities/user.entity';
import { UserProfile } from './entities/user-profile.entity';
import { ChallengeUserMap } from '../challenges/entities/challenge-user-map.entity';
import { WorkoutLog } from '../workout-log/entities/workout-log.entity';
import { ChallengeCategoryMap } from '../challenges/entities/challenge-category-map.entity';
import { ChallengeLocationMap } from '../challenges/entities/challenge-location-map.entity';
import { ChallengeCycleDay } from '../challenges/entities/challenge-cycle-days.entity';
import { FollowsService } from '../follows/follows.service';

const createMockRepo = () => ({
  find: jest.fn(),
  findOne: jest.fn(),
  save: jest.fn(),
  create: jest.fn(),
  createQueryBuilder: jest.fn(),
});

/** Mocks the two workoutRepo.createQueryBuilder() calls attachProgress makes
 * (completedCounts, then completedDayRows), in that order — plus the plain
 * workoutRepo.find() call for todayWorkouts. */
function mockWorkoutQueries(
  workoutRepo: ReturnType<typeof createMockRepo>,
  options: {
    todayWorkouts?: unknown[];
    completedCounts?: Array<{ challengeId: string; count: string }>;
    completedDayRows?: Array<{ challengeId: string; day: string }>;
  },
) {
  workoutRepo.find.mockResolvedValue(options.todayWorkouts ?? []);

  const completedCountsBuilder = {
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    groupBy: jest.fn().mockReturnThis(),
    getRawMany: jest.fn().mockResolvedValue(options.completedCounts ?? []),
  };
  const completedDayRowsBuilder = {
    select: jest.fn().mockReturnThis(),
    addSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    groupBy: jest.fn().mockReturnThis(),
    addGroupBy: jest.fn().mockReturnThis(),
    getRawMany: jest.fn().mockResolvedValue(options.completedDayRows ?? []),
  };

  workoutRepo.createQueryBuilder
    .mockReturnValueOnce(completedCountsBuilder)
    .mockReturnValueOnce(completedDayRowsBuilder);
}

/** Mocks challengeUserRepo.createQueryBuilder() as used by getUserChallenges
 * (leftJoinAndSelect/where/orderBy/getMany). */
function mockChallengeUserQueryBuilder(
  challengeUserRepo: ReturnType<typeof createMockRepo>,
  relations: unknown[],
) {
  challengeUserRepo.createQueryBuilder.mockReturnValue({
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue(relations),
  });
}

describe('UsersService', () => {
  let service: UsersService;
  let userRepo: ReturnType<typeof createMockRepo>;
  let profileRepo: ReturnType<typeof createMockRepo>;
  let challengeUserRepo: ReturnType<typeof createMockRepo>;
  let workoutRepo: ReturnType<typeof createMockRepo>;
  let challengeCategoryMapRepo: ReturnType<typeof createMockRepo>;
  let challengeLocationMapRepo: ReturnType<typeof createMockRepo>;
  let challengeCycleDayRepo: ReturnType<typeof createMockRepo>;
  let followsService: {
    isActiveFollower: jest.Mock;
    getCounts: jest.Mock;
    getFollowerCountsForUsers: jest.Mock;
    getFollowingCountsForUsers: jest.Mock;
  };

  const baseUser = () => ({
    id: 'user-1',
    username: 'alice',
    email: 'alice@example.com',
    is_active: true,
  });

  beforeEach(async () => {
    userRepo = createMockRepo();
    profileRepo = createMockRepo();
    challengeUserRepo = createMockRepo();
    workoutRepo = createMockRepo();
    challengeCategoryMapRepo = createMockRepo();
    challengeLocationMapRepo = createMockRepo();
    challengeCycleDayRepo = createMockRepo();
    // attachCategoriesAndLocations always runs in getUserChallenges — default
    // to no categories/locations unless a test cares about them.
    challengeCategoryMapRepo.find.mockResolvedValue([]);
    challengeLocationMapRepo.find.mockResolvedValue([]);
    challengeCycleDayRepo.find.mockResolvedValue([]);
    // Default: viewer does not follow the target — preserves the pre-B3
    // "strangers only see what a private profile allows" behavior unless a
    // test explicitly sets this to true.
    followsService = {
      isActiveFollower: jest.fn().mockResolvedValue(false),
      getCounts: jest
        .fn()
        .mockResolvedValue({ followersCount: 0, followingCount: 0 }),
      getFollowerCountsForUsers: jest.fn().mockResolvedValue(new Map()),
      getFollowingCountsForUsers: jest.fn().mockResolvedValue(new Map()),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getRepositoryToken(User), useValue: userRepo },
        { provide: getRepositoryToken(UserProfile), useValue: profileRepo },
        {
          provide: getRepositoryToken(ChallengeUserMap),
          useValue: challengeUserRepo,
        },
        { provide: getRepositoryToken(WorkoutLog), useValue: workoutRepo },
        {
          provide: getRepositoryToken(ChallengeCategoryMap),
          useValue: challengeCategoryMapRepo,
        },
        {
          provide: getRepositoryToken(ChallengeLocationMap),
          useValue: challengeLocationMapRepo,
        },
        {
          provide: getRepositoryToken(ChallengeCycleDay),
          useValue: challengeCycleDayRepo,
        },
        { provide: FollowsService, useValue: followsService },
      ],
    }).compile();

    service = module.get(UsersService);
  });

  describe('findById', () => {
    it('should never include password_hash in the response, even if the repository returned it', async () => {
      // Simulate a misconfigured `select` accidentally leaking the hash —
      // the DTO mapping must still strip it.
      userRepo.findOne.mockResolvedValue({
        ...baseUser(),
        password_hash: '$2b$10$leakedhashvalue',
      });

      const result = await service.findById('user-1');

      expect(result).not.toHaveProperty('password_hash');
      expect(JSON.stringify(result)).not.toContain('leakedhash');
      expect(result).toEqual(baseUser());
    });

    it('should query with an explicit select that excludes password_hash', async () => {
      userRepo.findOne.mockResolvedValue(baseUser());

      await service.findById('user-1');

      expect(userRepo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          select: expect.not.arrayContaining(['password_hash']),
        }),
      );
    });

    it('should throw NotFoundException when the user does not exist', async () => {
      userRepo.findOne.mockResolvedValue(null);

      await expect(service.findById('missing-id')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getMyProfile', () => {
    it('should fall back to username/defaults when the user has no profile row yet', async () => {
      userRepo.findOne.mockResolvedValue(baseUser());
      profileRepo.findOne.mockResolvedValue(null);

      const result = await service.getMyProfile('user-1');

      expect(result).toMatchObject({
        id: 'user-1',
        username: 'alice',
        display_name: 'alice',
        bio: null,
        preferred_language: 'en',
        profile_image_url: null,
        is_private: false,
      });
      // Reading must never create a row.
      expect(profileRepo.save).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException for an unknown user', async () => {
      userRepo.findOne.mockResolvedValue(null);

      await expect(service.getMyProfile('nope')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should include followers_count/following_count from FollowsService', async () => {
      userRepo.findOne.mockResolvedValue(baseUser());
      profileRepo.findOne.mockResolvedValue(null);
      followsService.getCounts.mockResolvedValue({
        followersCount: 4,
        followingCount: 9,
      });

      const result = await service.getMyProfile('user-1');

      expect(followsService.getCounts).toHaveBeenCalledWith('user-1');
      expect(result.followers_count).toBe(4);
      expect(result.following_count).toBe(9);
    });
  });

  describe('updateProfile', () => {
    it('should create the profile row on first edit and only change sent fields', async () => {
      userRepo.findOne.mockResolvedValue(baseUser());
      profileRepo.findOne.mockResolvedValue(null);
      profileRepo.create.mockImplementation((data: object) => ({ ...data }));
      profileRepo.save.mockImplementation((p: object) => Promise.resolve(p));

      const result = await service.updateProfile('user-1', {
        bio: 'Hello there',
      });

      expect(profileRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ user_id: 'user-1', display_name: 'alice' }),
      );
      expect(profileRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ bio: 'Hello there', display_name: 'alice' }),
      );
      expect(result.bio).toBe('Hello there');
      expect(result.display_name).toBe('alice');
    });

    it('should preserve fields that are not part of the request', async () => {
      userRepo.findOne.mockResolvedValue(baseUser());
      profileRepo.findOne.mockResolvedValue({
        user_id: 'user-1',
        display_name: 'Alice Original',
        bio: 'existing bio',
        preferred_language: 'es',
        is_private: true,
      });
      profileRepo.save.mockImplementation((p: object) => Promise.resolve(p));

      const result = await service.updateProfile('user-1', {
        display_name: 'Alice Nueva',
      });

      expect(result.display_name).toBe('Alice Nueva');
      expect(result.bio).toBe('existing bio');
      expect(result.preferred_language).toBe('es');
      expect(result.is_private).toBe(true);
    });

    it('should clear the bio with null (not undefined) when an empty string is sent', async () => {
      userRepo.findOne.mockResolvedValue(baseUser());
      profileRepo.findOne.mockResolvedValue({
        user_id: 'user-1',
        display_name: 'Alice',
        bio: 'old bio',
        preferred_language: 'en',
        is_private: false,
      });
      profileRepo.save.mockImplementation((p: object) => Promise.resolve(p));

      const result = await service.updateProfile('user-1', { bio: '   ' });

      expect(profileRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ bio: null }),
      );
      expect(result.bio).toBeNull();
    });

    it('should normalize a whitespace-only display_name back to the username', async () => {
      userRepo.findOne.mockResolvedValue(baseUser());
      profileRepo.findOne.mockResolvedValue({
        user_id: 'user-1',
        display_name: 'Alice',
        preferred_language: 'en',
        is_private: false,
      });
      profileRepo.save.mockImplementation((p: object) => Promise.resolve(p));

      const result = await service.updateProfile('user-1', {
        display_name: '   ',
      });

      expect(result.display_name).toBe('alice');
    });

    it('should throw NotFoundException for an unknown user without writing anything', async () => {
      userRepo.findOne.mockResolvedValue(null);

      await expect(service.updateProfile('nope', { bio: 'x' })).rejects.toThrow(
        NotFoundException,
      );
      expect(profileRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('updateProfilePhoto', () => {
    it('should persist the new photo URL', async () => {
      userRepo.findOne.mockResolvedValue(baseUser());
      profileRepo.findOne.mockResolvedValue({
        user_id: 'user-1',
        display_name: 'Alice',
        preferred_language: 'en',
        is_private: false,
      });
      profileRepo.save.mockImplementation((p: object) => Promise.resolve(p));

      const url = 'https://cdn.example.com/uploads/user-1/photo.jpeg';
      const result = await service.updateProfilePhoto('user-1', url);

      expect(profileRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ profile_image_url: url }),
      );
      expect(result.profile_image_url).toBe(url);
    });
  });

  describe('getPublicProfile', () => {
    it('should hide the bio and never expose the email for a private profile, for a viewer who is a stranger', async () => {
      userRepo.findOne.mockResolvedValue({ id: 'user-2', username: 'bob' });
      profileRepo.findOne.mockResolvedValue({
        user_id: 'user-2',
        display_name: 'Bob',
        bio: 'secret bio',
        preferred_language: 'en',
        profile_image_url: 'https://cdn.example.com/b.jpg',
        is_private: true,
      });

      const result = await service.getPublicProfile('user-2', 'user-1');

      expect(result.bio).toBeNull();
      expect(result.is_private).toBe(true);
      expect(result).not.toHaveProperty('email');
      // Photo and display name stay visible even on private profiles.
      expect(result.display_name).toBe('Bob');
      expect(result.profile_image_url).toBe('https://cdn.example.com/b.jpg');
    });

    it('should reveal the bio of a private profile to the owner viewing it through the public endpoint', async () => {
      userRepo.findOne.mockResolvedValue({ id: 'user-2', username: 'bob' });
      profileRepo.findOne.mockResolvedValue({
        user_id: 'user-2',
        display_name: 'Bob',
        bio: 'secret bio',
        is_private: true,
      });

      const result = await service.getPublicProfile('user-2', 'user-2');

      expect(result.bio).toBe('secret bio');
      expect(followsService.isActiveFollower).not.toHaveBeenCalled();
      // Viewing your own profile through the public endpoint is never
      // reported as "following yourself".
      expect(result.is_following).toBe(false);
    });

    it('should reveal the bio of a private profile to an active follower, and report is_following: true', async () => {
      userRepo.findOne.mockResolvedValue({ id: 'user-2', username: 'bob' });
      profileRepo.findOne.mockResolvedValue({
        user_id: 'user-2',
        display_name: 'Bob',
        bio: 'secret bio',
        is_private: true,
      });
      followsService.isActiveFollower.mockResolvedValue(true);

      const result = await service.getPublicProfile('user-2', 'user-1');

      expect(result.bio).toBe('secret bio');
      expect(followsService.isActiveFollower).toHaveBeenCalledWith(
        'user-1',
        'user-2',
      );
      expect(result.is_following).toBe(true);
    });

    it('should keep the bio hidden from a non-follower even when checked', async () => {
      userRepo.findOne.mockResolvedValue({ id: 'user-2', username: 'bob' });
      profileRepo.findOne.mockResolvedValue({
        user_id: 'user-2',
        display_name: 'Bob',
        bio: 'secret bio',
        is_private: true,
      });
      followsService.isActiveFollower.mockResolvedValue(false);

      const result = await service.getPublicProfile('user-2', 'user-1');

      expect(result.bio).toBeNull();
    });

    it('should expose the bio for a public profile but still no email', async () => {
      userRepo.findOne.mockResolvedValue({ id: 'user-2', username: 'bob' });
      profileRepo.findOne.mockResolvedValue({
        user_id: 'user-2',
        display_name: 'Bob',
        bio: 'public bio',
        is_private: false,
      });

      const result = await service.getPublicProfile('user-2', 'user-1');

      expect(result.bio).toBe('public bio');
      expect(result).not.toHaveProperty('email');
    });

    it('should throw NotFoundException for inactive or unknown users', async () => {
      userRepo.findOne.mockResolvedValue(null);

      await expect(service.getPublicProfile('ghost', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it("should include the target user's followers_count/following_count, not the viewer's", async () => {
      userRepo.findOne.mockResolvedValue({ id: 'user-2', username: 'bob' });
      profileRepo.findOne.mockResolvedValue({
        user_id: 'user-2',
        display_name: 'Bob',
        is_private: false,
      });
      followsService.getCounts.mockResolvedValue({
        followersCount: 12,
        followingCount: 3,
      });

      const result = await service.getPublicProfile('user-2', 'user-1');

      expect(followsService.getCounts).toHaveBeenCalledWith('user-2');
      expect(result.followers_count).toBe(12);
      expect(result.following_count).toBe(3);
    });
  });

  describe('searchUsers', () => {
    it('should return an empty list for a blank query without hitting the database', async () => {
      const result = await service.searchUsers('   ', 'user-1');

      expect(result).toEqual([]);
      expect(userRepo.find).not.toHaveBeenCalled();
    });

    it('should return safe public shapes for matches', async () => {
      userRepo.find.mockResolvedValue([{ id: 'user-2', username: 'bob' }]);
      profileRepo.find.mockResolvedValue([
        {
          user_id: 'user-2',
          display_name: 'Bob',
          bio: 'bio',
          is_private: false,
        },
      ]);

      const result = await service.searchUsers('bo', 'user-1');

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: 'user-2',
        username: 'bob',
        display_name: 'Bob',
      });
      expect(result[0]).not.toHaveProperty('email');
      expect(userRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({ take: 20 }),
      );
    });

    it('should attach per-user follower/following counts via a single batched lookup', async () => {
      userRepo.find.mockResolvedValue([
        { id: 'user-2', username: 'bob' },
        { id: 'user-3', username: 'carol' },
      ]);
      profileRepo.find.mockResolvedValue([]);
      followsService.getFollowerCountsForUsers.mockResolvedValue(
        new Map([
          ['user-2', 5],
          ['user-3', 0],
        ]),
      );
      followsService.getFollowingCountsForUsers.mockResolvedValue(
        new Map([['user-2', 1]]),
      );

      const result = await service.searchUsers('bo', 'user-1');

      expect(followsService.getFollowerCountsForUsers).toHaveBeenCalledWith([
        'user-2',
        'user-3',
      ]);
      expect(result.find((u) => u.id === 'user-2')).toMatchObject({
        followers_count: 5,
        following_count: 1,
      });
      expect(result.find((u) => u.id === 'user-3')).toMatchObject({
        followers_count: 0,
        following_count: 0,
      });
    });
  });

  describe('getUserChallenges (attachProgress / is_rest_day)', () => {
    // getUserChallenges' grouped-array return type is untyped (`any[]`) —
    // this local shape lets the assertions below stay type-safe instead of
    // triggering @typescript-eslint/no-unsafe-member-access. Note: the
    // formatted object spreads `c.challenge` (the Challenge entity, whose PK
    // is `id`), not the ChallengeUserMap relation itself — so `id` here is
    // the challenge id, same as `activeRelation`'s `challenge.id` below.
    interface FormattedActiveChallenge {
      id: string;
      current_day: number;
      today_completed: boolean;
      progress_percent: number;
      streak: number;
      is_rest_day: boolean;
    }

    function activeChallenges(result: {
      active: unknown[];
    }): FormattedActiveChallenge[] {
      return result.active as FormattedActiveChallenge[];
    }

    // joined "today" (UTC) so current_day is always 1 regardless of when the
    // test runs, which puts current_day_in_cycle at 1 too — deterministic,
    // same style as workout-log-streak.util.spec.ts's dayKey() helper.
    function activeRelation(
      challengeId: string,
      overrides: Partial<{ cycle_length_days: number | null }> = {},
    ) {
      return {
        challenge_id: challengeId,
        user_id: 'user-1',
        status: 'active',
        joined_at: new Date(),
        challenge: {
          id: challengeId,
          duration_days: 30,
          cycle_length_days: 3,
          ...overrides,
        },
      };
    }

    it('should mark is_rest_day: true when current_day_in_cycle lands on a rest cycle day', async () => {
      mockChallengeUserQueryBuilder(challengeUserRepo, [
        activeRelation('challenge-1'),
      ]);
      mockWorkoutQueries(workoutRepo, {});
      challengeCycleDayRepo.find.mockResolvedValue([
        { challenge_id: 'challenge-1', day_in_cycle: 1, day_type: 'rest' },
      ]);

      const result = await service.getUserChallenges('user-1');

      expect(result.active).toHaveLength(1);
      expect(activeChallenges(result)[0].is_rest_day).toBe(true);
    });

    it('should mark is_rest_day: false when current_day_in_cycle lands on a workout cycle day', async () => {
      mockChallengeUserQueryBuilder(challengeUserRepo, [
        activeRelation('challenge-1'),
      ]);
      mockWorkoutQueries(workoutRepo, {});
      challengeCycleDayRepo.find.mockResolvedValue([
        { challenge_id: 'challenge-1', day_in_cycle: 1, day_type: 'workout' },
      ]);

      const result = await service.getUserChallenges('user-1');

      expect(activeChallenges(result)[0].is_rest_day).toBe(false);
    });

    it('should default is_rest_day: false when the challenge has no cycle_length_days configured', async () => {
      mockChallengeUserQueryBuilder(challengeUserRepo, [
        activeRelation('challenge-1', { cycle_length_days: null }),
      ]);
      mockWorkoutQueries(workoutRepo, {});
      // Even if a stray cycle-day row exists, the guard must skip the lookup
      // entirely without a configured cycle length.
      challengeCycleDayRepo.find.mockResolvedValue([
        { challenge_id: 'challenge-1', day_in_cycle: 1, day_type: 'rest' },
      ]);

      const result = await service.getUserChallenges('user-1');

      expect(activeChallenges(result)[0].is_rest_day).toBe(false);
    });

    it('should batch the cycle-day lookup in a single query for every active challenge', async () => {
      mockChallengeUserQueryBuilder(challengeUserRepo, [
        activeRelation('challenge-1'),
        activeRelation('challenge-2'),
      ]);
      mockWorkoutQueries(workoutRepo, {});
      challengeCycleDayRepo.find.mockResolvedValue([]);

      await service.getUserChallenges('user-1');

      expect(challengeCycleDayRepo.find).toHaveBeenCalledTimes(1);
      const [options] = challengeCycleDayRepo.find.mock.calls[0] as [
        { where: { challenge_id: { value: string[] } } },
      ];
      expect([...options.where.challenge_id.value].sort()).toEqual([
        'challenge-1',
        'challenge-2',
      ]);
    });

    it('should not mix up rest days between two challenges sharing the same cycle position', async () => {
      mockChallengeUserQueryBuilder(challengeUserRepo, [
        activeRelation('challenge-1'),
        activeRelation('challenge-2'),
      ]);
      mockWorkoutQueries(workoutRepo, {});
      challengeCycleDayRepo.find.mockResolvedValue([
        { challenge_id: 'challenge-1', day_in_cycle: 1, day_type: 'rest' },
        { challenge_id: 'challenge-2', day_in_cycle: 1, day_type: 'workout' },
      ]);

      const result = await service.getUserChallenges('user-1');

      const byId = new Map(activeChallenges(result).map((c) => [c.id, c]));
      expect(byId.get('challenge-1')?.is_rest_day).toBe(true);
      expect(byId.get('challenge-2')?.is_rest_day).toBe(false);
    });

    it('should leave current_day/today_completed/progress_percent/streak unaffected', async () => {
      mockChallengeUserQueryBuilder(challengeUserRepo, [
        activeRelation('challenge-1'),
      ]);
      mockWorkoutQueries(workoutRepo, {
        todayWorkouts: [{ challengeId: 'challenge-1' }],
        completedCounts: [{ challengeId: 'challenge-1', count: '3' }],
      });
      challengeCycleDayRepo.find.mockResolvedValue([]);

      const result = await service.getUserChallenges('user-1');

      expect(result.active[0]).toMatchObject({
        current_day: 1,
        today_completed: true,
        progress_percent: 10, // 3 / 30 duration_days
        streak: 0,
        is_rest_day: false,
      });
    });
  });
});
