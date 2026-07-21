import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ExerciseMetric } from '../exercises/entities/exercise-metric.entity';
import { WorkoutLogExercise } from '../workout-log/entities/workout-log-exercise.entity';
import { MetricType, MetricValueType } from './entities/metric-type.entity';
import { WorkoutLogExerciseMetric } from './entities/workout-log-exercise-metric.entity';
import { MetricsService } from './metrics.service';

const createRepositoryMock = () => ({
  find: jest.fn(),
  findOne: jest.fn(),
  findOneBy: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  createQueryBuilder: jest.fn(),
});

const createQueryBuilderMock = () => {
  const queryBuilder = {
    where: jest.fn(),
    andWhere: jest.fn(),
    getOne: jest.fn(),
  };

  queryBuilder.where.mockReturnValue(queryBuilder);
  queryBuilder.andWhere.mockReturnValue(queryBuilder);
  return queryBuilder;
};

describe('MetricsService', () => {
  let service: MetricsService;
  let metricTypeRepo: ReturnType<typeof createRepositoryMock>;
  let workoutLogExerciseRepo: ReturnType<typeof createRepositoryMock>;
  let metricRepo: ReturnType<typeof createRepositoryMock>;
  let exerciseMetricRepo: ReturnType<typeof createRepositoryMock>;
  let allowedMetricQuery: ReturnType<typeof createQueryBuilderMock>;
  let existingMetricQuery: ReturnType<typeof createQueryBuilderMock>;

  beforeEach(async () => {
    metricTypeRepo = createRepositoryMock();
    workoutLogExerciseRepo = createRepositoryMock();
    metricRepo = createRepositoryMock();
    exerciseMetricRepo = createRepositoryMock();
    allowedMetricQuery = createQueryBuilderMock();
    existingMetricQuery = createQueryBuilderMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MetricsService,
        {
          provide: getRepositoryToken(MetricType),
          useValue: metricTypeRepo,
        },
        {
          provide: getRepositoryToken(WorkoutLogExercise),
          useValue: workoutLogExerciseRepo,
        },
        {
          provide: getRepositoryToken(WorkoutLogExerciseMetric),
          useValue: metricRepo,
        },
        {
          provide: getRepositoryToken(ExerciseMetric),
          useValue: exerciseMetricRepo,
        },
      ],
    }).compile();

    service = module.get(MetricsService);
    jest.clearAllMocks();
  });

  it('findAll returns all metric types', async () => {
    const metricTypes = [{ id: 1, code: 'reps' }];
    metricTypeRepo.find.mockResolvedValue(metricTypes);

    await expect(service.findAll()).resolves.toBe(metricTypes);
    expect(metricTypeRepo.find).toHaveBeenCalledTimes(1);
  });

  describe('addMetric', () => {
    beforeEach(() => {
      workoutLogExerciseRepo.findOne.mockResolvedValue({
        id: 5,
        exercise: { id: 9 },
      });
      metricTypeRepo.findOneBy.mockResolvedValue({
        id: 2,
        code: 'reps',
        valueType: MetricValueType.INT,
      });
      exerciseMetricRepo.createQueryBuilder.mockReturnValue(allowedMetricQuery);
      allowedMetricQuery.getOne.mockResolvedValue({ exerciseId: 9 });
      metricRepo.createQueryBuilder.mockReturnValue(existingMetricQuery);
      existingMetricQuery.getOne.mockResolvedValue(null);
      metricRepo.create.mockImplementation((data: object) => ({ ...data }));
      metricRepo.save.mockImplementation((metric: object) =>
        Promise.resolve(metric),
      );
    });

    it('rejects a missing workout-log exercise', async () => {
      workoutLogExerciseRepo.findOne.mockResolvedValue(null);

      const action = service.addMetric(99, 'reps', 10);

      await expect(action).rejects.toBeInstanceOf(BadRequestException);
      await expect(action).rejects.toThrow('WorkoutLogExercise not found');
      expect(metricTypeRepo.findOneBy).not.toHaveBeenCalled();
    });

    it('rejects an unknown metric type', async () => {
      metricTypeRepo.findOneBy.mockResolvedValue(null);

      const action = service.addMetric(5, 'unknown', 10);

      await expect(action).rejects.toBeInstanceOf(BadRequestException);
      await expect(action).rejects.toThrow("Metric type 'unknown' not found");
      expect(exerciseMetricRepo.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('rejects a metric that is not allowed for the exercise', async () => {
      allowedMetricQuery.getOne.mockResolvedValue(null);

      const action = service.addMetric(5, 'reps', 10);

      await expect(action).rejects.toBeInstanceOf(BadRequestException);
      await expect(action).rejects.toThrow(
        "Metric 'reps' is not allowed for this exercise",
      );
      expect(metricRepo.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('rejects a duplicate metric', async () => {
      existingMetricQuery.getOne.mockResolvedValue({ id: 20 });

      const action = service.addMetric(5, 'reps', 10);

      await expect(action).rejects.toBeInstanceOf(BadRequestException);
      await expect(action).rejects.toThrow(
        "Metric 'reps' already exists for this exercise",
      );
      expect(metricRepo.create).not.toHaveBeenCalled();
    });

    it.each([
      [MetricValueType.INT, 12, 'valueInt', 12],
      [MetricValueType.DECIMAL, 12.5, 'valueDecimal', 12.5],
      [MetricValueType.SECONDS, 90, 'valueSeconds', 90],
      [MetricValueType.BOOLEAN, 0, 'valueBoolean', false],
      [MetricValueType.BOOLEAN, 2, 'valueBoolean', true],
      [MetricValueType.TEXT, 42, 'valueText', '42'],
    ])(
      'maps %s values to the corresponding persistence field',
      async (valueType, value, property, expectedValue) => {
        metricTypeRepo.findOneBy.mockResolvedValue({
          id: 2,
          code: 'metric',
          valueType,
        });

        const result = await service.addMetric(5, 'metric', value);

        expect(workoutLogExerciseRepo.findOne).toHaveBeenCalledWith({
          where: { id: 5 },
          relations: { exercise: true },
        });
        expect(exerciseMetricRepo.createQueryBuilder).toHaveBeenCalledWith(
          'em',
        );
        expect(allowedMetricQuery.where).toHaveBeenCalledWith(
          'em.exercise = :exerciseId',
          { exerciseId: 9 },
        );
        expect(allowedMetricQuery.andWhere).toHaveBeenCalledWith(
          'em.metricType = :metricTypeId',
          { metricTypeId: 2 },
        );
        expect(metricRepo.createQueryBuilder).toHaveBeenCalledWith('m');
        expect(existingMetricQuery.where).toHaveBeenCalledWith(
          'm.workoutLogExercise = :wleId',
          { wleId: 5 },
        );
        expect(existingMetricQuery.andWhere).toHaveBeenCalledWith(
          'm.metricTypeId = :metricTypeId',
          { metricTypeId: 2 },
        );
        expect(metricRepo.create).toHaveBeenCalledWith({
          workoutLogExercise: { id: 5, exercise: { id: 9 } },
          metricTypeId: 2,
        });
        expect(metricRepo.save).toHaveBeenCalledWith(
          expect.objectContaining({ [property]: expectedValue }),
        );
        expect(result).toEqual(
          expect.objectContaining({ [property]: expectedValue }),
        );
      },
    );

    it('rejects unsupported metric value types', async () => {
      metricTypeRepo.findOneBy.mockResolvedValue({
        id: 2,
        code: 'unsupported',
        valueType: 'unsupported',
      });

      const action = service.addMetric(5, 'unsupported', 10);

      await expect(action).rejects.toBeInstanceOf(BadRequestException);
      await expect(action).rejects.toThrow('Unsupported metric type');
      expect(metricRepo.save).not.toHaveBeenCalled();
    });

    it('propagates persistence errors', async () => {
      const error = new Error('metric save failed');
      metricRepo.save.mockRejectedValue(error);

      await expect(service.addMetric(5, 'reps', 10)).rejects.toBe(error);
    });
  });
});
