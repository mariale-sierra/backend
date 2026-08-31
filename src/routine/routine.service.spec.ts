import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { RoutineService } from './routine.service';
import { Routine } from './entities/routine.entity';
import { RoutineExercise } from './entities/routine-exercise.entity';
import { Exercise } from '../exercises/entities/exercise.entity';
import { Challenge } from '../challenges/entities/challenge.entity';
import { MetricType } from '../metrics/entities/metric-type.entity';
import { ChallengesService } from '../challenges/challenges.service';
import { AddRoutineExerciseDto } from './dto/add-routine-exercise.dto';

const createMockRepo = () => ({
  find: jest.fn(),
  findOne: jest.fn(),
  findOneBy: jest.fn(),
  count: jest.fn(),
  save: jest.fn(),
  create: jest.fn((v: object) => v),
  createQueryBuilder: jest.fn(),
});

const REPS_METRIC_TYPE = { id: 100, code: 'reps', valueType: 'int' };
const DISTANCE_METRIC_TYPE = {
  id: 101,
  code: 'distance',
  valueType: 'decimal',
};

/** Fakes dataSource.transaction()'s EntityManager just enough to exercise
 * addExerciseToRoutine(): manager.create()/save() tag each row with the
 * entity class it was created for and assign it an incrementing id;
 * manager.getRepository(MetricType).findOne() resolves against a small
 * in-memory catalog; the final manager.findOne(RoutineExercise, ...)
 * re-fetch just echoes back what was saved for that id. */
function createFakeManager(metricTypes: Array<{ id: number }> = []) {
  const savedRows: Array<
    { __entity: { name: string } } & Record<string, unknown>
  > = [];
  let nextId = 1;

  const manager = {
    create: jest.fn((Entity: { name: string }, data: object) => ({
      __entity: Entity,
      ...data,
    })),
    save: jest.fn(
      (
        row: { __entity: { name: string }; id?: unknown } & Record<
          string,
          unknown
        >,
      ) => {
        row.id = `${row.__entity.name}-${nextId++}`;
        savedRows.push(row);
        return Promise.resolve(row);
      },
    ),
    getRepository: jest.fn((Entity: { name: string }) => ({
      findOne: jest.fn(({ where }: { where: { id: number } }) => {
        if (Entity.name !== 'MetricType') return Promise.resolve(null);
        return Promise.resolve(
          metricTypes.find((mt) => mt.id === where.id) ?? null,
        );
      }),
    })),
    // Real signature is findOne(EntityClass, options) — two args, not one.
    findOne: jest.fn(
      (_entity: unknown, options: { where: { id: unknown } }) =>
        Promise.resolve(
          savedRows.find(
            (row) =>
              row.__entity.name === 'RoutineExercise' &&
              row.id === options.where.id,
          ) ?? null,
        ) as Promise<unknown>,
    ),
  };

  return { manager, savedRows };
}

function rowsOfType(
  savedRows: Array<{ __entity: { name: string } } & Record<string, unknown>>,
  entityName: string,
) {
  return savedRows.filter((row) => row.__entity.name === entityName);
}

describe('RoutineService.addExerciseToRoutine', () => {
  let service: RoutineService;
  let routineRepo: ReturnType<typeof createMockRepo>;
  let routineExerciseRepo: ReturnType<typeof createMockRepo>;
  let exerciseRepo: ReturnType<typeof createMockRepo>;
  let metricTypeRepo: ReturnType<typeof createMockRepo>;
  let dataSource: { transaction: jest.Mock };

  const OWNER_ID = 'owner-1';
  const OTHER_USER_ID = 'other-2';
  const ROUTINE_ID = 42;

  beforeEach(async () => {
    routineRepo = createMockRepo();
    routineExerciseRepo = createMockRepo();
    exerciseRepo = createMockRepo();
    metricTypeRepo = createMockRepo();
    dataSource = { transaction: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RoutineService,
        { provide: ChallengesService, useValue: {} },
        { provide: DataSource, useValue: dataSource },
        { provide: getRepositoryToken(Routine), useValue: routineRepo },
        {
          provide: getRepositoryToken(RoutineExercise),
          useValue: routineExerciseRepo,
        },
        { provide: getRepositoryToken(Exercise), useValue: exerciseRepo },
        { provide: getRepositoryToken(Challenge), useValue: createMockRepo() },
        { provide: getRepositoryToken(MetricType), useValue: metricTypeRepo },
      ],
    }).compile();

    service = module.get(RoutineService);
  });

  function mockHappyPathLookups() {
    routineRepo.findOneBy.mockResolvedValue({
      id: ROUTINE_ID,
      createdByUserId: OWNER_ID,
    });
    exerciseRepo.findOneBy.mockResolvedValue({ id: 7 });
    routineExerciseRepo.count.mockResolvedValue(0);
  }

  it('should throw NotFoundException when the routine does not exist', async () => {
    routineRepo.findOneBy.mockResolvedValue(null);

    await expect(
      service.addExerciseToRoutine(999, { exerciseId: 7 }, OWNER_ID),
    ).rejects.toThrow(NotFoundException);
  });

  it('should reject adding to a routine owned by another user', async () => {
    routineRepo.findOneBy.mockResolvedValue({
      id: ROUTINE_ID,
      createdByUserId: OWNER_ID,
    });

    await expect(
      service.addExerciseToRoutine(
        ROUTINE_ID,
        { exerciseId: 7 },
        OTHER_USER_ID,
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('should throw NotFoundException when the exercise does not exist', async () => {
    routineRepo.findOneBy.mockResolvedValue({
      id: ROUTINE_ID,
      createdByUserId: OWNER_ID,
    });
    exerciseRepo.findOneBy.mockResolvedValue(null);

    await expect(
      service.addExerciseToRoutine(ROUTINE_ID, { exerciseId: 999 }, OWNER_ID),
    ).rejects.toThrow(NotFoundException);
  });

  it("should throw BadRequestException when a set gives 'reps' but no 'reps' metric type is seeded", async () => {
    mockHappyPathLookups();
    metricTypeRepo.findOne.mockResolvedValue(null); // no 'reps' metric type

    const dto: AddRoutineExerciseDto = {
      exerciseId: 7,
      sets: [{ set_number: 1, reps: 10 }],
    };

    await expect(
      service.addExerciseToRoutine(ROUTINE_ID, dto, OWNER_ID),
    ).rejects.toThrow(BadRequestException);
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('should create a bare routine_exercises row when no sets/targets are given (backward compatible)', async () => {
    mockHappyPathLookups();
    metricTypeRepo.findOne.mockResolvedValue(REPS_METRIC_TYPE);
    const { manager, savedRows } = createFakeManager([REPS_METRIC_TYPE]);
    dataSource.transaction.mockImplementation((cb: (m: unknown) => unknown) =>
      cb(manager),
    );

    await service.addExerciseToRoutine(ROUTINE_ID, { exerciseId: 7 }, OWNER_ID);

    expect(rowsOfType(savedRows, 'RoutineExercise')).toHaveLength(1);
    expect(rowsOfType(savedRows, 'RoutineExerciseSet')).toHaveLength(0);
    expect(rowsOfType(savedRows, 'RoutineExerciseTarget')).toHaveLength(0);
  });

  it('should set order_index to one past the routine’s current exercise count', async () => {
    routineRepo.findOneBy.mockResolvedValue({
      id: ROUTINE_ID,
      createdByUserId: OWNER_ID,
    });
    exerciseRepo.findOneBy.mockResolvedValue({ id: 7 });
    routineExerciseRepo.count.mockResolvedValue(3); // 3 exercises already in the routine
    metricTypeRepo.findOne.mockResolvedValue(REPS_METRIC_TYPE);
    const { manager, savedRows } = createFakeManager([REPS_METRIC_TYPE]);
    dataSource.transaction.mockImplementation((cb: (m: unknown) => unknown) =>
      cb(manager),
    );

    await service.addExerciseToRoutine(ROUTINE_ID, { exerciseId: 7 }, OWNER_ID);

    expect(rowsOfType(savedRows, 'RoutineExercise')[0].order_index).toBe(4);
  });

  it("should persist a set's reps via the 'reps' shorthand as a RoutineExerciseSetTarget, plus rest_seconds_after on the set itself", async () => {
    mockHappyPathLookups();
    metricTypeRepo.findOne.mockResolvedValue(REPS_METRIC_TYPE);
    const { manager, savedRows } = createFakeManager([REPS_METRIC_TYPE]);
    dataSource.transaction.mockImplementation((cb: (m: unknown) => unknown) =>
      cb(manager),
    );

    const dto: AddRoutineExerciseDto = {
      exerciseId: 7,
      sets: [{ set_number: 1, reps: 10, rest_seconds_after: 60 }],
    };
    await service.addExerciseToRoutine(ROUTINE_ID, dto, OWNER_ID);

    const sets = rowsOfType(savedRows, 'RoutineExerciseSet');
    expect(sets).toHaveLength(1);
    expect(sets[0]).toMatchObject({ set_number: 1, rest_seconds_after: 60 });

    const setTargets = rowsOfType(savedRows, 'RoutineExerciseSetTarget');
    expect(setTargets).toHaveLength(1);
    expect(setTargets[0]).toMatchObject({
      metric_type_id: REPS_METRIC_TYPE.id,
      target_value_int: 10,
      routine_exercise_set_id: sets[0].id,
    });
  });

  it('should persist an explicit per-set target (metric_type_id + value) alongside the reps shorthand', async () => {
    mockHappyPathLookups();
    metricTypeRepo.findOne.mockResolvedValue(REPS_METRIC_TYPE);
    const { manager, savedRows } = createFakeManager([
      REPS_METRIC_TYPE,
      DISTANCE_METRIC_TYPE,
    ]);
    dataSource.transaction.mockImplementation((cb: (m: unknown) => unknown) =>
      cb(manager),
    );

    const dto: AddRoutineExerciseDto = {
      exerciseId: 7,
      sets: [
        {
          set_number: 1,
          targets: [{ metric_type_id: DISTANCE_METRIC_TYPE.id, value: 5 }],
        },
      ],
    };
    await service.addExerciseToRoutine(ROUTINE_ID, dto, OWNER_ID);

    const setTargets = rowsOfType(savedRows, 'RoutineExerciseSetTarget');
    expect(setTargets).toHaveLength(1);
    expect(setTargets[0]).toMatchObject({
      metric_type_id: DISTANCE_METRIC_TYPE.id,
      target_value_decimal: 5,
    });
  });

  it('should persist exercise-level targets (not tied to a set) as RoutineExerciseTarget rows', async () => {
    mockHappyPathLookups();
    metricTypeRepo.findOne.mockResolvedValue(null); // no sets in this test, 'reps' lookup irrelevant
    const { manager, savedRows } = createFakeManager([DISTANCE_METRIC_TYPE]);
    dataSource.transaction.mockImplementation((cb: (m: unknown) => unknown) =>
      cb(manager),
    );

    const dto: AddRoutineExerciseDto = {
      exerciseId: 7,
      targets: [{ metric_type_id: DISTANCE_METRIC_TYPE.id, value: 3 }],
    };
    await service.addExerciseToRoutine(ROUTINE_ID, dto, OWNER_ID);

    const targets = rowsOfType(savedRows, 'RoutineExerciseTarget');
    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({
      metric_type_id: DISTANCE_METRIC_TYPE.id,
      target_value_decimal: 3,
    });
  });

  it('should reject an exercise-level target with an unknown metric_type_id', async () => {
    mockHappyPathLookups();
    metricTypeRepo.findOne.mockResolvedValue(null);
    const { manager } = createFakeManager([]); // empty catalog — nothing resolves

    dataSource.transaction.mockImplementation((cb: (m: unknown) => unknown) =>
      cb(manager),
    );

    const dto: AddRoutineExerciseDto = {
      exerciseId: 7,
      targets: [{ metric_type_id: 999, value: 3 }],
    };

    await expect(
      service.addExerciseToRoutine(ROUTINE_ID, dto, OWNER_ID),
    ).rejects.toThrow(BadRequestException);
  });
});

describe('RoutineService.getTodayRoutine', () => {
  let service: RoutineService;
  let challengeService: { getToday: jest.Mock };

  const CHALLENGE_ID = 'challenge-1';
  const USER_ID = 'user-1';

  beforeEach(async () => {
    challengeService = { getToday: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RoutineService,
        { provide: ChallengesService, useValue: challengeService },
        { provide: DataSource, useValue: { transaction: jest.fn() } },
        { provide: getRepositoryToken(Routine), useValue: createMockRepo() },
        {
          provide: getRepositoryToken(RoutineExercise),
          useValue: createMockRepo(),
        },
        { provide: getRepositoryToken(Exercise), useValue: createMockRepo() },
        { provide: getRepositoryToken(Challenge), useValue: createMockRepo() },
        { provide: getRepositoryToken(MetricType), useValue: createMockRepo() },
      ],
    }).compile();

    service = module.get(RoutineService);
  });

  // Real bug: this was the one remaining call site still silently defaulting
  // to UTC — ChallengesService.getToday()'s own `timezone = 'UTC'` fallback
  // masked the missing argument instead of surfacing it, so the metrics-entry
  // screen kept using UTC "today" even after every other current-day call
  // site had already been fixed to use the caller's real timezone.
  it('passes the timezone through to challengeService.getToday()', async () => {
    challengeService.getToday.mockResolvedValue({ hasWorkout: false });

    await service.getTodayRoutine(CHALLENGE_ID, USER_ID, 'America/Los_Angeles');

    expect(challengeService.getToday).toHaveBeenCalledWith(
      CHALLENGE_ID,
      USER_ID,
      'America/Los_Angeles',
    );
  });

  it('defaults to UTC when no timezone is given, matching the pre-fix behavior', async () => {
    challengeService.getToday.mockResolvedValue({ hasWorkout: false });

    await service.getTodayRoutine(CHALLENGE_ID, USER_ID);

    expect(challengeService.getToday).toHaveBeenCalledWith(
      CHALLENGE_ID,
      USER_ID,
      'UTC',
    );
  });
});
