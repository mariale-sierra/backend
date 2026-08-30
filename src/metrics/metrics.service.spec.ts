import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { MetricsService } from './metrics.service';
import { MetricType } from './entities/metric-type.entity';
import { WorkoutLogExercise } from '../workout-log/entities/workout-log-exercise.entity';
import { WorkoutLogExerciseMetric } from './entities/workout-log-exercise-metric.entity';
import { ExerciseMetric } from '../exercises/entities/exercise-metric.entity';
import { WorkoutLogExerciseSet } from '../workout-log/entities/workout-log-exercise-set.entity';
import { WorkoutLogExerciseSetTarget } from '../workout-log/entities/workout-log-exercise-set-target.entity';

const createMockRepo = () => ({
  find: jest.fn(),
  findOne: jest.fn(),
  findOneBy: jest.fn(),
  save: jest.fn(),
  create: jest.fn((v) => v),
  createQueryBuilder: jest.fn(),
});

const buildQueryBuilder = (result: unknown) => ({
  where: jest.fn().mockReturnThis(),
  andWhere: jest.fn().mockReturnThis(),
  getOne: jest.fn().mockResolvedValue(result),
});

describe('MetricsService', () => {
  let service: MetricsService;
  let wleRepo: ReturnType<typeof createMockRepo>;
  let metricTypeRepo: ReturnType<typeof createMockRepo>;
  let metricRepo: ReturnType<typeof createMockRepo>;
  let exerciseMetricRepo: ReturnType<typeof createMockRepo>;
  let wlesRepo: ReturnType<typeof createMockRepo>;
  let wlesTargetRepo: ReturnType<typeof createMockRepo>;

  const OWNER_ID = 'owner-1';
  const OTHER_USER_ID = 'other-2';

  beforeEach(async () => {
    wleRepo = createMockRepo();
    metricTypeRepo = createMockRepo();
    metricRepo = createMockRepo();
    exerciseMetricRepo = createMockRepo();
    wlesRepo = createMockRepo();
    wlesTargetRepo = createMockRepo();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MetricsService,
        { provide: getRepositoryToken(MetricType), useValue: metricTypeRepo },
        { provide: getRepositoryToken(WorkoutLogExercise), useValue: wleRepo },
        {
          provide: getRepositoryToken(WorkoutLogExerciseMetric),
          useValue: metricRepo,
        },
        {
          provide: getRepositoryToken(ExerciseMetric),
          useValue: exerciseMetricRepo,
        },
        {
          provide: getRepositoryToken(WorkoutLogExerciseSet),
          useValue: wlesRepo,
        },
        {
          provide: getRepositoryToken(WorkoutLogExerciseSetTarget),
          useValue: wlesTargetRepo,
        },
      ],
    }).compile();

    service = module.get(MetricsService);
  });

  const wleOwnedBy = (userId: string) => ({
    id: 5,
    exercise: { id: 'exercise-1' },
    workout: { userId },
  });

  it('should reject attaching a metric to a workout-log-exercise owned by another user', async () => {
    wleRepo.findOne.mockResolvedValue(wleOwnedBy(OWNER_ID));

    await expect(
      service.addMetric(5, 'reps', 12, OTHER_USER_ID),
    ).rejects.toThrow(ForbiddenException);
    expect(metricTypeRepo.findOneBy).not.toHaveBeenCalled();
  });

  it('should throw NotFoundException when the workout-log-exercise does not exist', async () => {
    wleRepo.findOne.mockResolvedValue(null);

    await expect(service.addMetric(999, 'reps', 12, OWNER_ID)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('should add the metric when the caller owns the workout log', async () => {
    wleRepo.findOne.mockResolvedValue(wleOwnedBy(OWNER_ID));
    metricTypeRepo.findOneBy.mockResolvedValue({
      id: 'mt-1',
      code: 'reps',
      valueType: 'int',
    });
    exerciseMetricRepo.createQueryBuilder.mockReturnValue(
      buildQueryBuilder({ id: 'allowed-1' }),
    );
    metricRepo.createQueryBuilder.mockReturnValue(buildQueryBuilder(null)); // no duplicate
    metricRepo.save.mockImplementation((m) => Promise.resolve(m));

    const result = await service.addMetric(5, 'reps', 12, OWNER_ID);

    expect(result.valueInt).toBe(12);
    expect(metricRepo.save).toHaveBeenCalled();
  });

  it('should reject a metric type that is not allowed for the exercise', async () => {
    wleRepo.findOne.mockResolvedValue(wleOwnedBy(OWNER_ID));
    metricTypeRepo.findOneBy.mockResolvedValue({
      id: 'mt-1',
      code: 'reps',
      valueType: 'int',
    });
    exerciseMetricRepo.createQueryBuilder.mockReturnValue(
      buildQueryBuilder(null),
    ); // not allowed

    await expect(service.addMetric(5, 'reps', 12, OWNER_ID)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('should reject a duplicate metric for the same workout-log-exercise', async () => {
    wleRepo.findOne.mockResolvedValue(wleOwnedBy(OWNER_ID));
    metricTypeRepo.findOneBy.mockResolvedValue({
      id: 'mt-1',
      code: 'reps',
      valueType: 'int',
    });
    exerciseMetricRepo.createQueryBuilder.mockReturnValue(
      buildQueryBuilder({ id: 'allowed-1' }),
    );
    metricRepo.createQueryBuilder.mockReturnValue(
      buildQueryBuilder({ id: 'existing-metric' }),
    );

    await expect(service.addMetric(5, 'reps', 12, OWNER_ID)).rejects.toThrow(
      BadRequestException,
    );
  });
});

describe('MetricsService.addSetMetric', () => {
  let service: MetricsService;
  let metricTypeRepo: ReturnType<typeof createMockRepo>;
  let exerciseMetricRepo: ReturnType<typeof createMockRepo>;
  let wlesRepo: ReturnType<typeof createMockRepo>;
  let wlesTargetRepo: ReturnType<typeof createMockRepo>;

  const OWNER_ID = 'owner-1';
  const OTHER_USER_ID = 'other-2';

  const setOwnedBy = (userId: string) => ({
    id: 7,
    workoutLogExercise: {
      exercise: { id: 'exercise-1' },
      workout: { userId },
    },
  });

  beforeEach(async () => {
    metricTypeRepo = createMockRepo();
    exerciseMetricRepo = createMockRepo();
    wlesRepo = createMockRepo();
    wlesTargetRepo = createMockRepo();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MetricsService,
        { provide: getRepositoryToken(MetricType), useValue: metricTypeRepo },
        {
          provide: getRepositoryToken(WorkoutLogExercise),
          useValue: createMockRepo(),
        },
        {
          provide: getRepositoryToken(WorkoutLogExerciseMetric),
          useValue: createMockRepo(),
        },
        {
          provide: getRepositoryToken(ExerciseMetric),
          useValue: exerciseMetricRepo,
        },
        {
          provide: getRepositoryToken(WorkoutLogExerciseSet),
          useValue: wlesRepo,
        },
        {
          provide: getRepositoryToken(WorkoutLogExerciseSetTarget),
          useValue: wlesTargetRepo,
        },
      ],
    }).compile();

    service = module.get(MetricsService);
  });

  it('should throw NotFoundException when the set does not exist', async () => {
    wlesRepo.findOne.mockResolvedValue(null);

    await expect(
      service.addSetMetric(999, 'time', 30, OWNER_ID),
    ).rejects.toThrow(NotFoundException);
  });

  it('should reject a set on a workout log owned by another user', async () => {
    wlesRepo.findOne.mockResolvedValue(setOwnedBy(OWNER_ID));

    await expect(
      service.addSetMetric(7, 'time', 30, OTHER_USER_ID),
    ).rejects.toThrow(ForbiddenException);
    expect(metricTypeRepo.findOneBy).not.toHaveBeenCalled();
  });

  it('should reject an unknown metric code', async () => {
    wlesRepo.findOne.mockResolvedValue(setOwnedBy(OWNER_ID));
    metricTypeRepo.findOneBy.mockResolvedValue(null);

    await expect(
      service.addSetMetric(7, 'bogus', 30, OWNER_ID),
    ).rejects.toThrow(BadRequestException);
  });

  it('should reject a metric not allowed for the exercise', async () => {
    wlesRepo.findOne.mockResolvedValue(setOwnedBy(OWNER_ID));
    metricTypeRepo.findOneBy.mockResolvedValue({
      id: 'mt-time',
      code: 'time',
      valueType: 'seconds',
    });
    exerciseMetricRepo.createQueryBuilder.mockReturnValue(
      buildQueryBuilder(null),
    );

    await expect(service.addSetMetric(7, 'time', 30, OWNER_ID)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('should create a new target when the set has none for this metric yet', async () => {
    wlesRepo.findOne.mockResolvedValue(setOwnedBy(OWNER_ID));
    metricTypeRepo.findOneBy.mockResolvedValue({
      id: 'mt-time',
      code: 'time',
      valueType: 'seconds',
    });
    exerciseMetricRepo.createQueryBuilder.mockReturnValue(
      buildQueryBuilder({ id: 'allowed-1' }),
    );
    wlesTargetRepo.findOne.mockResolvedValue(null);
    wlesTargetRepo.save.mockImplementation((t: object) => Promise.resolve(t));

    const result = await service.addSetMetric(7, 'time', 45, OWNER_ID);

    // create()'s mock returns the same object reference it was given, and
    // the service mutates that object afterward (clearing/setting value_*
    // columns) — objectContaining rather than an exact match, since checking
    // the exact call args would really be checking the post-mutation state.
    expect(wlesTargetRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        workoutLogExerciseSetId: 7,
        metricTypeId: 'mt-time',
      }),
    );
    expect((result as { targetValueSeconds?: number }).targetValueSeconds).toBe(
      45,
    );
  });

  it("should overwrite the existing target's value in place (upsert), not reject as a duplicate", async () => {
    wlesRepo.findOne.mockResolvedValue(setOwnedBy(OWNER_ID));
    metricTypeRepo.findOneBy.mockResolvedValue({
      id: 'mt-time',
      code: 'time',
      valueType: 'seconds',
    });
    exerciseMetricRepo.createQueryBuilder.mockReturnValue(
      buildQueryBuilder({ id: 'allowed-1' }),
    );
    const existingTarget = {
      id: 1,
      workoutLogExerciseSetId: 7,
      metricTypeId: 'mt-time',
      targetValueSeconds: 20, // planned target copied from the routine
    };
    wlesTargetRepo.findOne.mockResolvedValue(existingTarget);
    wlesTargetRepo.save.mockImplementation((t: object) => Promise.resolve(t));

    const result = (await service.addSetMetric(7, 'time', 45, OWNER_ID)) as {
      id: number;
      targetValueSeconds?: number;
    };

    expect(wlesTargetRepo.create).not.toHaveBeenCalled();
    expect(result.id).toBe(1);
    expect(result.targetValueSeconds).toBe(45);
  });

  it('should clear other value_* columns when overwriting an existing target (no stale value under a different column)', async () => {
    wlesRepo.findOne.mockResolvedValue(setOwnedBy(OWNER_ID));
    metricTypeRepo.findOneBy.mockResolvedValue({
      id: 'mt-reps',
      code: 'reps',
      valueType: 'int',
    });
    exerciseMetricRepo.createQueryBuilder.mockReturnValue(
      buildQueryBuilder({ id: 'allowed-1' }),
    );
    const existingTarget = {
      id: 1,
      targetValueInt: undefined,
      targetValueSeconds: 999, // stale value under the wrong column
    };
    wlesTargetRepo.findOne.mockResolvedValue(existingTarget);
    wlesTargetRepo.save.mockImplementation((t: object) => Promise.resolve(t));

    const result = (await service.addSetMetric(7, 'reps', 12, OWNER_ID)) as {
      targetValueInt?: number;
      targetValueSeconds?: number;
    };

    expect(result.targetValueInt).toBe(12);
    expect(result.targetValueSeconds).toBeUndefined();
  });
});
