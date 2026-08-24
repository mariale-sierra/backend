import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ChallengesService } from './challenges.service';
import { Challenge } from './entities/challenge.entity';
import { User } from '../users/entities/user.entity';
import { ChallengeUserMap } from './entities/challenge-user-map.entity';
import { WorkoutLog } from '../workout-log/entities/workout-log.entity';
import { ChallengeCycleDay } from './entities/challenge-cycle-days.entity';
import { Routine } from '../routine/entities/routine.entity';
import { ChallengeCategoryMap } from './entities/challenge-category-map.entity';
import { ChallengeLocationMap } from './entities/challenge-location-map.entity';
import { ExerciseCategory } from '../exercises/entities/exercise-category.entity';
import { ExerciseLocation } from '../exercises/entities/exercise-location.entity';

type MockRepo = {
  find: jest.Mock;
  findOne: jest.Mock;
  save: jest.Mock;
  remove: jest.Mock;
  create: jest.Mock;
  createQueryBuilder: jest.Mock;
};

const createMockRepo = (): MockRepo => ({
  find: jest.fn(),
  findOne: jest.fn(),
  save: jest.fn(),
  remove: jest.fn(),
  create: jest.fn(),
  createQueryBuilder: jest.fn(),
});

describe('ChallengesService', () => {
  let service: ChallengesService;
  let challengeRepo: MockRepo;
  let challengeCycleDaysRepo: MockRepo;
  let userRepo: MockRepo;
  let challengeUserMapRepo: MockRepo;
  let challengeCategoryMapRepo: MockRepo;
  let challengeLocationMapRepo: MockRepo;

  const OWNER_ID = 'owner-1';
  const OTHER_USER_ID = 'other-2';
  const CHALLENGE_ID = 'challenge-1';

  const baseChallenge = () => ({
    id: CHALLENGE_ID,
    name: 'Test challenge',
    created_by_user_id: OWNER_ID,
    duration_days: 30,
    cycle_length_days: 7,
  });

  beforeEach(async () => {
    challengeRepo = createMockRepo();
    challengeCycleDaysRepo = createMockRepo();
    userRepo = createMockRepo();
    challengeUserMapRepo = createMockRepo();
    challengeCategoryMapRepo = createMockRepo();
    challengeLocationMapRepo = createMockRepo();
    // attachCategoriesAndLocations runs on every findAll()/findOne() call —
    // default to none unless a test cares about them.
    challengeCategoryMapRepo.find.mockResolvedValue([]);
    challengeLocationMapRepo.find.mockResolvedValue([]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChallengesService,
        { provide: getRepositoryToken(Challenge), useValue: challengeRepo },
        { provide: getRepositoryToken(User), useValue: userRepo },
        {
          provide: getRepositoryToken(ChallengeUserMap),
          useValue: challengeUserMapRepo,
        },
        { provide: getRepositoryToken(WorkoutLog), useValue: createMockRepo() },
        {
          provide: getRepositoryToken(ChallengeCycleDay),
          useValue: challengeCycleDaysRepo,
        },
        { provide: getRepositoryToken(Routine), useValue: createMockRepo() },
        {
          provide: getRepositoryToken(ChallengeCategoryMap),
          useValue: challengeCategoryMapRepo,
        },
        {
          provide: getRepositoryToken(ChallengeLocationMap),
          useValue: challengeLocationMapRepo,
        },
        {
          provide: getRepositoryToken(ExerciseCategory),
          useValue: createMockRepo(),
        },
        {
          provide: getRepositoryToken(ExerciseLocation),
          useValue: createMockRepo(),
        },
        { provide: DataSource, useValue: { transaction: jest.fn() } },
      ],
    }).compile();

    service = module.get(ChallengesService);
  });

  describe('update', () => {
    it('should allow the creator to update their own challenge', async () => {
      const challenge = baseChallenge();
      challengeRepo.findOne.mockResolvedValue(challenge);
      challengeRepo.save.mockResolvedValue({ ...challenge, name: 'Updated' });

      const result = await service.update(
        CHALLENGE_ID,
        { name: 'Updated' },
        OWNER_ID,
      );

      expect(challengeRepo.save).toHaveBeenCalled();
      expect(result.challenge.name).toBe('Updated');
    });

    it('should reject updating a challenge the caller did not create', async () => {
      challengeRepo.findOne.mockResolvedValue(baseChallenge());

      await expect(
        service.update(CHALLENGE_ID, { name: 'Hacked' } as any, OTHER_USER_ID),
      ).rejects.toThrow(ForbiddenException);
      expect(challengeRepo.save).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException when the challenge does not exist', async () => {
      challengeRepo.findOne.mockResolvedValue(null);

      await expect(
        service.update('missing-id', { name: 'x' } as any, OWNER_ID),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('should allow the creator to remove their own challenge', async () => {
      const challenge = baseChallenge();
      challengeRepo.findOne.mockResolvedValue(challenge);
      challengeRepo.remove.mockResolvedValue(challenge);

      const result = await service.remove(CHALLENGE_ID, OWNER_ID);

      expect(challengeRepo.remove).toHaveBeenCalledWith(challenge);
      expect(result).toEqual({ message: 'Challenge deleted successfully' });
    });

    it('should reject removing a challenge the caller did not create', async () => {
      challengeRepo.findOne.mockResolvedValue(baseChallenge());

      await expect(service.remove(CHALLENGE_ID, OTHER_USER_ID)).rejects.toThrow(
        ForbiddenException,
      );
      expect(challengeRepo.remove).not.toHaveBeenCalled();
    });
  });

  describe('updateCycleDay', () => {
    const cycleDayDto = { day_type: 'workout' } as any;

    it('should allow the creator to update a cycle day', async () => {
      challengeRepo.findOne.mockResolvedValue(baseChallenge());
      challengeCycleDaysRepo.findOne.mockResolvedValue({
        id: 'cycle-1',
        challenge_id: CHALLENGE_ID,
        day_in_cycle: 1,
        day_type: 'rest',
        routine_id: null,
      });
      challengeCycleDaysRepo.save.mockResolvedValue({});
      challengeCycleDaysRepo.createQueryBuilder.mockReturnValue({
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue({
          id: 'cycle-1',
          day_in_cycle: 1,
          day_type: 'workout',
          routine_id: null,
        }),
      });

      const result = await service.updateCycleDay(
        CHALLENGE_ID,
        1,
        cycleDayDto,
        OWNER_ID,
      );

      expect(challengeCycleDaysRepo.save).toHaveBeenCalled();
      expect(result.message).toBe('Challenge cycle day updated successfully');
    });

    it('should reject updating a cycle day when the caller did not create the challenge', async () => {
      challengeRepo.findOne.mockResolvedValue(baseChallenge());

      await expect(
        service.updateCycleDay(CHALLENGE_ID, 1, cycleDayDto, OTHER_USER_ID),
      ).rejects.toThrow(ForbiddenException);
      expect(challengeCycleDaysRepo.findOne).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException when the challenge does not exist', async () => {
      challengeRepo.findOne.mockResolvedValue(null);

      await expect(
        service.updateCycleDay('missing-id', 1, cycleDayDto, OWNER_ID),
      ).rejects.toThrow(NotFoundException);
    });
  });
  describe('joinChallenge', () => {
    it('should join an existing challenge as an active participant', async () => {
      userRepo.findOne.mockResolvedValue({ id: OTHER_USER_ID });
      challengeRepo.findOne.mockResolvedValue(baseChallenge());
      challengeUserMapRepo.findOne.mockResolvedValue(null);
      challengeUserMapRepo.create.mockImplementation((data: object) => ({
        ...data,
      }));
      challengeUserMapRepo.save.mockImplementation((m: object) =>
        Promise.resolve(m),
      );

      const result = await service.joinChallenge(OTHER_USER_ID, CHALLENGE_ID);

      expect(challengeUserMapRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: OTHER_USER_ID,
          challenge_id: CHALLENGE_ID,
          role: 'participant',
          status: 'active',
        }),
      );
      expect(result.message).toBe('Joined successfully');
    });

    it('should reject the creator joining their own challenge', async () => {
      userRepo.findOne.mockResolvedValue({ id: OWNER_ID });
      challengeRepo.findOne.mockResolvedValue(baseChallenge());

      await expect(
        service.joinChallenge(OWNER_ID, CHALLENGE_ID),
      ).rejects.toThrow('You cannot join a challenge you created');
    });

    it('should reject joining twice', async () => {
      userRepo.findOne.mockResolvedValue({ id: OTHER_USER_ID });
      challengeRepo.findOne.mockResolvedValue(baseChallenge());
      challengeUserMapRepo.findOne.mockResolvedValue({
        user_id: OTHER_USER_ID,
        challenge_id: CHALLENGE_ID,
      });

      await expect(
        service.joinChallenge(OTHER_USER_ID, CHALLENGE_ID),
      ).rejects.toThrow('Already joined this challenge');
    });

    it('should throw NotFoundException when the challenge does not exist', async () => {
      userRepo.findOne.mockResolvedValue({ id: OTHER_USER_ID });
      challengeRepo.findOne.mockResolvedValue(null);

      await expect(
        service.joinChallenge(OTHER_USER_ID, CHALLENGE_ID),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('findAll', () => {
    /** Mocks challengeUserMapRepo.createQueryBuilder() as findAll()'s
     * batched member-count query uses it (select/addSelect/where/andWhere/
     * groupBy/getRawMany). */
    function mockMemberCountQuery(
      rows: Array<{ challengeId: string; count: string }>,
    ) {
      const builder = {
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        getRawMany: jest.fn().mockResolvedValue(rows),
      };
      challengeUserMapRepo.createQueryBuilder.mockReturnValue(builder);
      return builder;
    }

    it('should return an empty list without querying member counts when there are no challenges', async () => {
      challengeRepo.find.mockResolvedValue([]);

      const result = await service.findAll();

      expect(result.data).toEqual([]);
      expect(challengeUserMapRepo.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('should attach members_joined to every challenge, matching what findOne() returns for the same challenge', async () => {
      challengeRepo.find.mockResolvedValue([
        { id: 'challenge-1', name: 'A' },
        { id: 'challenge-2', name: 'B' },
      ]);
      mockMemberCountQuery([
        { challengeId: 'challenge-1', count: '5' },
        { challengeId: 'challenge-2', count: '2' },
      ]);

      const result = await service.findAll();

      const byId = new Map(
        result.data.map((c: { id: string; members_joined: number }) => [
          c.id,
          c.members_joined,
        ]),
      );
      expect(byId.get('challenge-1')).toBe(5);
      expect(byId.get('challenge-2')).toBe(2);
    });

    it('should not mix up counts between challenges', async () => {
      challengeRepo.find.mockResolvedValue([
        { id: 'challenge-1', name: 'A' },
        { id: 'challenge-2', name: 'B' },
      ]);
      // Rows deliberately out of order vs. the challenges array, to catch
      // any accidental reliance on array index instead of the id map.
      mockMemberCountQuery([
        { challengeId: 'challenge-2', count: '9' },
        { challengeId: 'challenge-1', count: '1' },
      ]);

      const result = await service.findAll();

      const byId = new Map(
        result.data.map((c: { id: string; members_joined: number }) => [
          c.id,
          c.members_joined,
        ]),
      );
      expect(byId.get('challenge-1')).toBe(1);
      expect(byId.get('challenge-2')).toBe(9);
    });

    it('should default members_joined to 0, not undefined, for a challenge with no active members', async () => {
      challengeRepo.find.mockResolvedValue([{ id: 'challenge-1', name: 'A' }]);
      mockMemberCountQuery([]); // no rows at all for this challenge

      const result = await service.findAll();

      expect(result.data[0].members_joined).toBe(0);
    });

    it('should run a single batched query for the member counts, not one per challenge', async () => {
      challengeRepo.find.mockResolvedValue([
        { id: 'challenge-1', name: 'A' },
        { id: 'challenge-2', name: 'B' },
        { id: 'challenge-3', name: 'C' },
      ]);
      const builder = mockMemberCountQuery([]);

      await service.findAll();

      expect(challengeUserMapRepo.createQueryBuilder).toHaveBeenCalledTimes(1);
      expect(builder.where).toHaveBeenCalledWith(
        'cum.challenge_id IN (:...ids)',
        { ids: ['challenge-1', 'challenge-2', 'challenge-3'] },
      );
      expect(builder.andWhere).toHaveBeenCalledWith('cum.status = :status', {
        status: 'active',
      });
    });
  });
});
