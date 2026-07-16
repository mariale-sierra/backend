import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { MetricsService } from './metrics.service';
import { MetricType } from './entities/metric-type.entity';
import { WorkoutLogExercise } from '../workout-log/entities/workout-log-exercise.entity';
import { WorkoutLogExerciseMetric } from './entities/workout-log-exercise-metric.entity';
import { ExerciseMetric } from '../exercises/entities/exercise-metric.entity';

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

  const OWNER_ID = 'owner-1';
  const OTHER_USER_ID = 'other-2';

  beforeEach(async () => {
    wleRepo = createMockRepo();
    metricTypeRepo = createMockRepo();
    metricRepo = createMockRepo();
    exerciseMetricRepo = createMockRepo();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MetricsService,
        { provide: getRepositoryToken(MetricType), useValue: metricTypeRepo },
        { provide: getRepositoryToken(WorkoutLogExercise), useValue: wleRepo },
        { provide: getRepositoryToken(WorkoutLogExerciseMetric), useValue: metricRepo },
        { provide: getRepositoryToken(ExerciseMetric), useValue: exerciseMetricRepo },
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
    metricTypeRepo.findOneBy.mockResolvedValue({ id: 'mt-1', code: 'reps', valueType: 'int' });
    exerciseMetricRepo.createQueryBuilder.mockReturnValue(buildQueryBuilder({ id: 'allowed-1' }));
    metricRepo.createQueryBuilder.mockReturnValue(buildQueryBuilder(null)); // no duplicate
    metricRepo.save.mockImplementation((m) => Promise.resolve(m));

    const result = await service.addMetric(5, 'reps', 12, OWNER_ID);

    expect(result.valueInt).toBe(12);
    expect(metricRepo.save).toHaveBeenCalled();
  });

  it('should reject a metric type that is not allowed for the exercise', async () => {
    wleRepo.findOne.mockResolvedValue(wleOwnedBy(OWNER_ID));
    metricTypeRepo.findOneBy.mockResolvedValue({ id: 'mt-1', code: 'reps', valueType: 'int' });
    exerciseMetricRepo.createQueryBuilder.mockReturnValue(buildQueryBuilder(null)); // not allowed

    await expect(service.addMetric(5, 'reps', 12, OWNER_ID)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('should reject a duplicate metric for the same workout-log-exercise', async () => {
    wleRepo.findOne.mockResolvedValue(wleOwnedBy(OWNER_ID));
    metricTypeRepo.findOneBy.mockResolvedValue({ id: 'mt-1', code: 'reps', valueType: 'int' });
    exerciseMetricRepo.createQueryBuilder.mockReturnValue(buildQueryBuilder({ id: 'allowed-1' }));
    metricRepo.createQueryBuilder.mockReturnValue(buildQueryBuilder({ id: 'existing-metric' }));

    await expect(service.addMetric(5, 'reps', 12, OWNER_ID)).rejects.toThrow(
      BadRequestException,
    );
  });
});
