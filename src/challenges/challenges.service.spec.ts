import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Between, DataSource } from 'typeorm';
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
import { getDominantActivityCategories } from './dominant-activity-category.util';
import { CreateChallengeDto } from './dto/create-challenge.dto';

// findAll()/findOne() delegate the dominant-category computation entirely to
// this util — its own SQL/tie-break logic is covered by
// dominant-activity-category.util.spec.ts, so this file only exercises how
// ChallengesService calls it and merges the result (matches the same
// jest.mock split used for workout-log-streak.util in follows.service.spec.ts).
jest.mock('./dominant-activity-category.util', () => ({
  getDominantActivityCategories: jest.fn(),
}));
const mockGetDominantActivityCategories =
  getDominantActivityCategories as jest.Mock;

type MockRepo = {
  find: jest.Mock;
  findOne: jest.Mock;
  save: jest.Mock;
  remove: jest.Mock;
  create: jest.Mock;
  createQueryBuilder: jest.Mock;
  count: jest.Mock;
  manager: unknown;
};

const createMockRepo = (): MockRepo => ({
  find: jest.fn(),
  findOne: jest.fn(),
  save: jest.fn(),
  remove: jest.fn(),
  create: jest.fn(),
  createQueryBuilder: jest.fn(),
  count: jest.fn(),
  manager: {},
});

describe('ChallengesService', () => {
  let service: ChallengesService;
  let challengeRepo: MockRepo;
  let challengeCycleDaysRepo: MockRepo;
  let userRepo: MockRepo;
  let challengeUserMapRepo: MockRepo;
  let challengeCategoryMapRepo: MockRepo;
  let challengeLocationMapRepo: MockRepo;
  let workoutRepo: MockRepo;
  let dataSource: { transaction: jest.Mock };

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
    workoutRepo = createMockRepo();
    // attachCategoriesAndLocations runs on every findAll()/findOne() call —
    // default to none unless a test cares about them.
    challengeCategoryMapRepo.find.mockResolvedValue([]);
    challengeLocationMapRepo.find.mockResolvedValue([]);
    mockGetDominantActivityCategories.mockReset().mockResolvedValue(new Map());
    dataSource = { transaction: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChallengesService,
        { provide: getRepositoryToken(Challenge), useValue: challengeRepo },
        { provide: getRepositoryToken(User), useValue: userRepo },
        {
          provide: getRepositoryToken(ChallengeUserMap),
          useValue: challengeUserMapRepo,
        },
        { provide: getRepositoryToken(WorkoutLog), useValue: workoutRepo },
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
        { provide: DataSource, useValue: dataSource },
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

    it('should attach dominant_activity_category from the batched util, keyed correctly per challenge', async () => {
      challengeRepo.find.mockResolvedValue([
        { id: 'challenge-1', name: 'A' },
        { id: 'challenge-2', name: 'B' },
      ]);
      mockMemberCountQuery([]);
      mockGetDominantActivityCategories.mockResolvedValue(
        new Map([
          ['challenge-1', 'cardioIntense'],
          ['challenge-2', null],
        ]),
      );

      const result = await service.findAll();

      const byId = new Map(
        result.data.map(
          (c: { id: string; dominant_activity_category: string | null }) => [
            c.id,
            c.dominant_activity_category,
          ],
        ),
      );
      expect(byId.get('challenge-1')).toBe('cardioIntense');
      expect(byId.get('challenge-2')).toBeNull();
    });

    it('should call the dominant-category util once with every challenge id and the cycle-days repo manager', async () => {
      challengeRepo.find.mockResolvedValue([
        { id: 'challenge-1', name: 'A' },
        { id: 'challenge-2', name: 'B' },
      ]);
      mockMemberCountQuery([]);

      await service.findAll();

      expect(mockGetDominantActivityCategories).toHaveBeenCalledTimes(1);
      expect(mockGetDominantActivityCategories).toHaveBeenCalledWith(
        challengeCycleDaysRepo.manager,
        ['challenge-1', 'challenge-2'],
      );
    });

    it('should default dominant_activity_category to null, not undefined, when the util has no entry for a challenge', async () => {
      challengeRepo.find.mockResolvedValue([{ id: 'challenge-1', name: 'A' }]);
      mockMemberCountQuery([]);
      mockGetDominantActivityCategories.mockResolvedValue(new Map());

      const result = await service.findAll();

      expect(result.data[0].dominant_activity_category).toBeNull();
    });
  });

  describe('findOne', () => {
    it('should include members_joined and dominant_activity_category alongside the existing enriched fields', async () => {
      challengeRepo.findOne.mockResolvedValue(baseChallenge());
      challengeCycleDaysRepo.createQueryBuilder.mockReturnValue({
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      });
      challengeUserMapRepo.count.mockResolvedValue(7);
      mockGetDominantActivityCategories.mockResolvedValue(
        new Map([[CHALLENGE_ID, 'flexibility']]),
      );

      const result = await service.findOne(CHALLENGE_ID);

      expect(result.members_joined).toBe(7);
      expect(result.dominant_activity_category).toBe('flexibility');
    });

    it('should default dominant_activity_category to null when the util returns nothing for this challenge', async () => {
      challengeRepo.findOne.mockResolvedValue(baseChallenge());
      challengeCycleDaysRepo.createQueryBuilder.mockReturnValue({
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      });
      challengeUserMapRepo.count.mockResolvedValue(0);
      mockGetDominantActivityCategories.mockResolvedValue(new Map());

      const result = await service.findOne(CHALLENGE_ID);

      expect(result.dominant_activity_category).toBeNull();
    });

    it('should call the dominant-category util scoped to just this one challenge id', async () => {
      challengeRepo.findOne.mockResolvedValue(baseChallenge());
      challengeCycleDaysRepo.createQueryBuilder.mockReturnValue({
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      });
      challengeUserMapRepo.count.mockResolvedValue(0);

      await service.findOne(CHALLENGE_ID);

      expect(mockGetDominantActivityCategories).toHaveBeenCalledWith(
        challengeCycleDaysRepo.manager,
        [CHALLENGE_ID],
      );
    });

    it('should throw NotFoundException for a missing challenge without calling the dominant-category util', async () => {
      challengeRepo.findOne.mockResolvedValue(null);

      await expect(service.findOne('missing-id')).rejects.toThrow(
        NotFoundException,
      );
      expect(mockGetDominantActivityCategories).not.toHaveBeenCalled();
    });
  });

  describe('create (linkChallengeCategories order_index)', () => {
    /** Fakes dataSource.transaction()'s manager just enough for create() to
     * run: manager.create()/save() for Challenge, ChallengeUserMap, and
     * (via linkChallengeCategories -> findOrCreateCategoryId)
     * ExerciseCategory + ChallengeCategoryMap rows. Every category name is
     * treated as new (getOne() -> null) so findOrCreateCategoryId always
     * takes the "create" path — the id assigned doesn't matter for this
     * test, only the order_index persisted on each ChallengeCategoryMap row. */
    function createFakeTransactionManager() {
      const savedCategoryMapRows: Array<{
        challengeId: string;
        categoryId: number;
        orderIndex: number;
      }> = [];
      let nextCategoryId = 1;

      const categoryQueryBuilder = {
        where: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(null),
      };

      type FakeRow = { __entity: unknown; id?: unknown } & Record<
        string,
        unknown
      >;

      const manager = {
        create: jest.fn(
          (Entity: unknown, data: object): FakeRow => ({
            __entity: Entity,
            ...data,
          }),
        ),
        save: jest.fn((entity: FakeRow) => {
          if (entity.__entity === ChallengeCategoryMap) {
            savedCategoryMapRows.push(
              entity as unknown as {
                challengeId: string;
                categoryId: number;
                orderIndex: number;
              },
            );
          } else if (entity.__entity === ExerciseCategory) {
            entity.id = nextCategoryId++;
          } else if (entity.__entity === Challenge) {
            entity.id = CHALLENGE_ID;
          }
          return Promise.resolve(entity);
        }),
        getRepository: jest.fn(() => ({
          createQueryBuilder: jest.fn(() => categoryQueryBuilder),
        })),
      };

      return { manager, savedCategoryMapRows };
    }

    it('should persist orderIndex matching the position each category was given in the request, after dedup', async () => {
      userRepo.findOne.mockResolvedValue({ id: OWNER_ID });
      const { manager, savedCategoryMapRows } = createFakeTransactionManager();
      dataSource.transaction.mockImplementation((cb: (m: unknown) => unknown) =>
        cb(manager),
      );

      await service.create(
        {
          name: 'Test Challenge',
          visibility: 'public',
          duration_days: 30,
          cycle_length_days: 7,
          categories: ['Cardio Intense', 'Strength', 'Cardio Intense'], // dup
        } as any,
        OWNER_ID,
      );

      expect(savedCategoryMapRows).toHaveLength(2); // the repeat was deduped
      expect(savedCategoryMapRows.map((r) => r.orderIndex)).toEqual([0, 1]);
    });
  });

  describe('create → resolveExercise (exercise_metrics pollution fix)', () => {
    /** Fakes dataSource.transaction()'s manager for the create() -> cycle_days
     * -> createCycleDay() -> resolveExercise() chain. Every "does X already
     * exist" lookup (category/location/map rows) defaults to "no" so each
     * helper takes its create-new path without erroring — the one exception
     * is the Exercise lookup itself, which is configurable per test via
     * `existingExercises`, since that's the one branch this fix changes. */
    function createFakeManager(
      existingExercises: Array<{ id: number; name: string }> = [],
    ) {
      const savedRows: Array<{ __entity: string } & Record<string, unknown>> =
        [];
      let nextId = 1;
      const existingByLowerName = new Map(
        existingExercises.map((e) => [e.name.toLowerCase(), e]),
      );

      interface FakeQueryBuilder {
        where: jest.Mock;
        getOne: jest.Mock;
      }

      function exerciseQueryBuilder(): FakeQueryBuilder {
        let searchedName = '';
        const qb: FakeQueryBuilder = {
          where: jest.fn((_sql: string, params: { name: string }) => {
            searchedName = params.name.toLowerCase();
            return qb;
          }),
          getOne: jest.fn(() =>
            Promise.resolve(existingByLowerName.get(searchedName) ?? null),
          ),
        };
        return qb;
      }

      function noopFindOneQueryBuilder(): FakeQueryBuilder {
        const qb: FakeQueryBuilder = {
          where: jest.fn().mockReturnThis(),
          getOne: jest.fn(() => Promise.resolve(null)),
        };
        return qb;
      }

      const manager = {
        create: jest.fn((Entity: { name: string }, data: object) => ({
          __entity: Entity.name,
          ...data,
        })),
        save: jest.fn(
          (
            row: { __entity: string; id?: unknown } & Record<string, unknown>,
          ) => {
            if (row.id === undefined) row.id = nextId++;
            savedRows.push(row);
            return Promise.resolve(row);
          },
        ),
        getRepository: jest.fn((Entity: { name: string }) => {
          // Every fake repo gets the same .create() TypeORM's per-repository
          // create() provides (some helpers call manager.getRepository(X).create(),
          // not manager.create(X, ...) directly — e.g. resolveExercise's
          // exerciseRepo.create(), ensureExerciseCategory's mapRepo.create()).
          const create = jest.fn((data: object) => ({
            __entity: Entity.name,
            ...data,
          }));

          switch (Entity.name) {
            case 'Exercise':
              return {
                create,
                createQueryBuilder: jest.fn(() => exerciseQueryBuilder()),
                findOne: jest.fn(() => Promise.resolve(null)), // slug never collides
              };
            case 'MetricType':
              return {
                create,
                findOne: jest.fn(({ where }: { where: { code: string } }) =>
                  Promise.resolve(
                    where.code === 'reps'
                      ? { id: 1, code: 'reps' }
                      : where.code === 'weight'
                        ? { id: 2, code: 'weight' }
                        : null,
                  ),
                ),
              };
            case 'ExerciseCategoryMap':
            case 'ExerciseLocationMap':
            case 'ExerciseMetric':
              return { create, findOne: jest.fn(() => Promise.resolve(null)) };
            default:
              // ExerciseCategory/ExerciseLocation's findOrCreateCategoryId/
              // findOrCreateLocationId lookups — "not found" so each just
              // creates a fresh row.
              return {
                create,
                createQueryBuilder: jest.fn(() => noopFindOneQueryBuilder()),
                findOne: jest.fn(() => Promise.resolve(null)),
              };
          }
        }),
      };

      return { manager, savedRows };
    }

    function baseChallengeDto(exerciseName: string): CreateChallengeDto {
      return {
        name: 'Test Challenge',
        visibility: 'public',
        duration_days: 30,
        cycle_length_days: 7,
        cycle_days: [
          {
            day_number: 1,
            is_rest_day: false,
            exercises: [
              {
                name: exerciseName,
                location: 'Anywhere',
                metric_type: 'schema',
                activity_type: 'cardioLow',
                metrics: { kind: 'schema', values: {} },
              },
            ],
          },
        ],
      } as unknown as CreateChallengeDto;
    }

    it("should register 'reps'/'weight' exercise_metrics for a genuinely NEW exercise", async () => {
      userRepo.findOne.mockResolvedValue({ id: OWNER_ID });
      const { manager, savedRows } = createFakeManager([]); // catalog empty — exercise is new
      dataSource.transaction.mockImplementation((cb: (m: unknown) => unknown) =>
        cb(manager),
      );

      await service.create(baseChallengeDto('Brand New Exercise'), OWNER_ID);

      const metricRows = savedRows.filter(
        (r) => r.__entity === 'ExerciseMetric',
      );
      expect(metricRows.map((r) => r.metricTypeId).sort()).toEqual([1, 2]);
    });

    it("should NOT register 'reps'/'weight' exercise_metrics when reusing an existing exercise by name (the bug)", async () => {
      userRepo.findOne.mockResolvedValue({ id: OWNER_ID });
      const { manager, savedRows } = createFakeManager([
        { id: 55, name: 'Brisk Walk' }, // already in the catalog
      ]);
      dataSource.transaction.mockImplementation((cb: (m: unknown) => unknown) =>
        cb(manager),
      );

      // Matched case-insensitively, same as resolveExercise's own lookup.
      await service.create(baseChallengeDto('brisk walk'), OWNER_ID);

      const metricRows = savedRows.filter(
        (r) => r.__entity === 'ExerciseMetric',
      );
      expect(metricRows).toHaveLength(0);

      // And no second Exercise row got created — it was genuinely reused.
      const exerciseRows = savedRows.filter((r) => r.__entity === 'Exercise');
      expect(exerciseRows).toHaveLength(0);
    });
  });

  describe('getCycleDaySummaries', () => {
    /** Mocks challengeCycleDaysRepo.createQueryBuilder() — the fluent chain
     * getCycleDaySummaries() builds (leftJoinAndSelect x N, where, orderBy,
     * addOrderBy, getMany). */
    function mockCycleDaysQuery(rows: unknown[]) {
      const qb = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        addOrderBy: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(rows),
      };
      challengeCycleDaysRepo.createQueryBuilder.mockReturnValue(qb);
      return qb;
    }

    it('should join sets/targets the same way RoutineService.getTodayRoutine() does, alongside the existing category joins', async () => {
      const qb = mockCycleDaysQuery([]);

      await service.getCycleDaySummaries(CHALLENGE_ID);

      const joinedRelations = (
        qb.leftJoinAndSelect.mock.calls as unknown[][]
      ).map((call) => call[0] as string);
      expect(joinedRelations).toEqual(
        expect.arrayContaining([
          'routineExercise.sets',
          'sets.targets',
          'setTargets.metricType',
          'routineExercise.targets',
          'targets.metricType',
        ]),
      );
      expect(qb.addOrderBy).toHaveBeenCalledWith('sets.set_number', 'ASC');
    });

    it('should return an empty exercises array for a rest day with no routine', async () => {
      mockCycleDaysQuery([
        { day_in_cycle: 1, day_type: 'rest', routine: null },
      ]);

      const result = await service.getCycleDaySummaries(CHALLENGE_ID);

      expect(result).toEqual([
        {
          day_number: 1,
          is_rest_day: true,
          routine_name: undefined,
          routine_description: undefined,
          exercises: [],
        },
      ]);
    });

    it('should include real per-set data (id, set_number, rest_seconds_after, targets) instead of the old name/activity_type-only shape', async () => {
      mockCycleDaysQuery([
        {
          day_in_cycle: 1,
          day_type: 'workout',
          routine: {
            name: 'Leg Day',
            description: 'Lower body focus',
            routine_exercises: [
              {
                exercise: {
                  name: 'Squat',
                  description: 'Compound lower body lift.',
                  category_maps: [
                    { isPrimary: true, category: { name: 'Strength' } },
                  ],
                },
                sets: [
                  {
                    id: 'set-1',
                    set_number: 1,
                    rest_seconds_after: 60,
                    targets: [
                      {
                        metric_type_id: 1,
                        metricType: { code: 'reps' },
                        target_value_int: 10,
                        target_value_decimal: null,
                        target_value_seconds: null,
                      },
                    ],
                  },
                ],
                targets: [],
              },
            ],
          },
        },
      ]);

      const result = await service.getCycleDaySummaries(CHALLENGE_ID);

      expect(result[0].exercises[0]).toEqual({
        name: 'Squat',
        description: 'Compound lower body lift.',
        activity_type: 'strength',
        sets: [
          {
            id: 'set-1',
            set_number: 1,
            rest_seconds_after: 60,
            targets: [
              {
                metric_type_id: 1,
                metricType: { code: 'reps' },
                target_value_int: 10,
                target_value_decimal: null,
                target_value_seconds: null,
              },
            ],
          },
        ],
        targets: [],
      });
    });

    it('should default description to null when the exercise has none, rather than undefined', async () => {
      mockCycleDaysQuery([
        {
          day_in_cycle: 1,
          day_type: 'workout',
          routine: {
            name: 'Day',
            description: null,
            routine_exercises: [
              {
                exercise: {
                  name: 'No-Description Exercise',
                  description: undefined,
                  category_maps: [],
                },
                sets: [],
                targets: [],
              },
            ],
          },
        },
      ]);

      const result = await service.getCycleDaySummaries(CHALLENGE_ID);

      expect(result[0].exercises[0].description).toBeNull();
    });

    it('should fall back to exercise-level targets when the exercise has no per-set rows (matches getTodayRoutine’s two-tier shape)', async () => {
      mockCycleDaysQuery([
        {
          day_in_cycle: 1,
          day_type: 'workout',
          routine: {
            name: 'Cardio Day',
            description: null,
            routine_exercises: [
              {
                exercise: {
                  name: 'Brisk Walk',
                  category_maps: [
                    { isPrimary: true, category: { name: 'Cardio Low' } },
                  ],
                },
                sets: [],
                targets: [
                  {
                    metric_type_id: 5,
                    metricType: { code: 'time' },
                    target_value_int: null,
                    target_value_decimal: null,
                    target_value_seconds: 1200,
                  },
                ],
              },
            ],
          },
        },
      ]);

      const result = await service.getCycleDaySummaries(CHALLENGE_ID);

      expect(result[0].exercises[0].activity_type).toBe('cardioLow');
      expect(result[0].exercises[0].sets).toEqual([]);
      expect(result[0].exercises[0].targets).toEqual([
        {
          metric_type_id: 5,
          metricType: { code: 'time' },
          target_value_int: null,
          target_value_decimal: null,
          target_value_seconds: 1200,
        },
      ]);
    });

    it('should default a target’s metricType to null rather than crash when the relation is missing', async () => {
      mockCycleDaysQuery([
        {
          day_in_cycle: 1,
          day_type: 'workout',
          routine: {
            name: 'Day',
            description: null,
            routine_exercises: [
              {
                exercise: { name: 'Mystery Exercise', category_maps: [] },
                sets: [],
                targets: [
                  { metric_type_id: 99, metricType: null, target_value_int: 1 },
                ],
              },
            ],
          },
        },
      ]);

      const result = await service.getCycleDaySummaries(CHALLENGE_ID);

      expect(result[0].exercises[0].targets[0]).toMatchObject({
        metric_type_id: 99,
        metricType: null,
      });
    });
  });

  describe('timezone-aware current day (getProgress / getToday / getProgressSummary)', () => {
    const JOINED_AT = new Date('2026-08-27T12:00:00.000Z');

    beforeEach(() => {
      challengeUserMapRepo.findOne.mockResolvedValue({
        user_id: OWNER_ID,
        challenge_id: CHALLENGE_ID,
        status: 'active',
        joined_at: JOINED_AT,
      });
      challengeRepo.findOne.mockResolvedValue(baseChallenge());
      workoutRepo.findOne.mockResolvedValue(null);
      workoutRepo.count.mockResolvedValue(0);
      challengeCycleDaysRepo.createQueryBuilder.mockReturnValue({
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(null),
      });
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    // The bug: a user behind UTC saw the challenge day (and "completed
    // today") roll over as soon as the SERVER's UTC day ticked, even while it
    // was still "yesterday" on their own device — e.g. a photo uploaded late
    // in the evening, local time, still showed as belonging to a day that had
    // already "ended" per the old UTC-only calculation.
    it('does not roll currentDay over just because UTC crossed midnight, for a user behind UTC', async () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-08-28T04:00:00.000Z'));

      const utcResult = await service.getProgress(
        OWNER_ID,
        CHALLENGE_ID,
        'UTC',
      );
      const laResult = await service.getProgress(
        OWNER_ID,
        CHALLENGE_ID,
        'America/Los_Angeles',
      );

      expect(utcResult!.currentDay).toBe(2); // UTC already rolled over
      expect(laResult!.currentDay).toBe(1); // still "yesterday" locally
    });

    // Reverse direction: a user ahead of UTC must see the day roll over as
    // soon as THEIR local midnight passes, without waiting for UTC's.
    it('rolls currentDay over as soon as local midnight passes, even before UTC midnight, for a user ahead of UTC', async () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-08-27T16:00:00.000Z'));

      const utcResult = await service.getProgress(
        OWNER_ID,
        CHALLENGE_ID,
        'UTC',
      );
      const tokyoResult = await service.getProgress(
        OWNER_ID,
        CHALLENGE_ID,
        'Asia/Tokyo',
      );

      expect(utcResult!.currentDay).toBe(1); // UTC hasn't rolled over yet
      expect(tokyoResult!.currentDay).toBe(2); // already "today" locally
    });

    it('falls back to UTC when no timezone is provided, matching the pre-fix behavior', async () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-08-28T04:00:00.000Z'));

      const result = await service.getProgress(OWNER_ID, CHALLENGE_ID);

      expect(result!.currentDay).toBe(2);
    });

    it('never throws for an unrecognized timezone string, degrading to UTC', async () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-08-28T04:00:00.000Z'));

      await expect(
        service.getProgress(OWNER_ID, CHALLENGE_ID, 'Not/AZone'),
      ).resolves.toMatchObject({ currentDay: 2 });
    });

    it('threads the timezone through getToday()', async () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-08-28T04:00:00.000Z'));

      const result = await service.getToday(
        CHALLENGE_ID,
        OWNER_ID,
        'America/Los_Angeles',
      );

      expect(result.currentDay).toBe(1);
    });

    it('threads the timezone through getProgressSummary()', async () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-08-28T04:00:00.000Z'));

      const result = await service.getProgressSummary(
        CHALLENGE_ID,
        OWNER_ID,
        'America/Los_Angeles',
      );

      expect(result.currentDay).toBe(1);
    });

    it('bounds "completed today" by the local calendar day, not UTC, and reports hoursLeftToday against the local end-of-day', async () => {
      jest.useFakeTimers();
      // 2026-08-28T04:00:00Z is 2026-08-27T21:00:00 local in LA — 3 hours
      // before local midnight, i.e. before the local day ends.
      jest.setSystemTime(new Date('2026-08-28T04:00:00.000Z'));

      const result = await service.getProgress(
        OWNER_ID,
        CHALLENGE_ID,
        'America/Los_Angeles',
      );

      expect(workoutRepo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            started_at: Between(
              new Date('2026-08-27T07:00:00.000Z'),
              new Date('2026-08-28T06:59:59.999Z'),
            ),
          }),
        }),
      );
      expect(result!.hoursLeftToday).toBe(3);
    });
  });

  describe('getToday() cycle position uses the CAPPED currentDay (regression: two services used to disagree)', () => {
    afterEach(() => {
      jest.useRealTimers();
    });

    // Real bug, reproduced against the live "mind body challenge"
    // (duration_days=28, cycle_length_days=4, day4=workout): once a user has
    // been enrolled longer than the challenge's own duration,
    // calculateCurrentDay() used to feed the UNCAPPED elapsed-days count
    // into the cycle-position formula here, while UsersService.attachProgress()
    // capped it first — so the Log Metrics picker (capped, sees a workout
    // day) and this very endpoint (uncapped, saw a rest day) disagreed for
    // the same instant. Both now go through the same shared
    // getCycleDayInfo(), which always caps before computing the position.
    it('computes the cycle position from the capped day, not the raw elapsed-days count', async () => {
      const joinedAt = new Date('2026-08-01T00:00:00.000Z');
      jest.useFakeTimers();
      // 29 full days after joining -> raw elapsed day 30, 2 days past the
      // 28-day duration.
      jest.setSystemTime(new Date('2026-08-30T00:00:00.000Z'));

      challengeUserMapRepo.findOne.mockResolvedValue({
        user_id: OWNER_ID,
        challenge_id: CHALLENGE_ID,
        status: 'active',
        joined_at: joinedAt,
      });
      challengeRepo.findOne.mockResolvedValue({
        ...baseChallenge(),
        duration_days: 28,
        cycle_length_days: 4,
      });

      const andWhere = jest.fn().mockReturnThis();
      challengeCycleDaysRepo.createQueryBuilder.mockReturnValue({
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere,
        getOne: jest.fn().mockResolvedValue({
          id: 'cycle-day-4',
          day_in_cycle: 4,
          day_type: 'workout',
          routine_id: 'routine-1',
          routine: null,
        }),
      });

      const result = await service.getToday(CHALLENGE_ID, OWNER_ID, 'UTC');

      expect(result.currentDay).toBe(28); // capped, not the raw 30
      // ((28-1) % 4) + 1 = 4 — NOT ((30-1) % 4) + 1 = 2, the rest day the
      // uncapped bug produced for this same instant.
      expect(result.currentDayInCycle).toBe(4);
      expect(result.day_type).toBe('workout');
      expect(andWhere).toHaveBeenCalledWith(
        'cycleDay.day_in_cycle = :dayInCycle',
        { dayInCycle: 4 },
      );
    });
  });
});
