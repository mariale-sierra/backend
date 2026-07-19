import { BadRequestException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test, TestingModule } from '@nestjs/testing';
import { ExerciseMetric } from '../exercises/entities/exercise-metric.entity';
import { WorkoutLogExercise } from '../workout-log/entities/workout-log-exercise.entity';
import { MetricType, MetricValueType } from './entities/metric-type.entity';
import { WorkoutLogExerciseMetric } from './entities/workout-log-exercise-metric.entity';
import { MetricsService } from './metrics.service';

function queryBuilderReturning(value: unknown) {
  return {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    getOne: jest.fn().mockResolvedValue(value),
  };
}

describe('MetricsService', () => {
  let service: MetricsService;
  let metricTypeRepo: { findOneBy: jest.Mock };
  let workoutExerciseRepo: { findOne: jest.Mock };
  let metricRepo: {
    createQueryBuilder: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };
  let exerciseMetricRepo: { createQueryBuilder: jest.Mock };

  beforeEach(async () => {
    metricTypeRepo = { findOneBy: jest.fn() };
    workoutExerciseRepo = { findOne: jest.fn() };
    metricRepo = {
      createQueryBuilder: jest.fn(),
      create: jest.fn((value) => ({ ...value })),
      save: jest.fn((value) => Promise.resolve(value)),
    };
    exerciseMetricRepo = { createQueryBuilder: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MetricsService,
        {
          provide: getRepositoryToken(MetricType),
          useValue: metricTypeRepo,
        },
        {
          provide: getRepositoryToken(WorkoutLogExercise),
          useValue: workoutExerciseRepo,
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
  });

  it('stores a decimal metric in the matching value column', async () => {
    const workoutExercise = { id: 10, exercise: { id: 3 } };
    workoutExerciseRepo.findOne.mockResolvedValue(workoutExercise);
    metricTypeRepo.findOneBy.mockResolvedValue({
      id: 7,
      code: 'weight',
      valueType: MetricValueType.DECIMAL,
    });
    exerciseMetricRepo.createQueryBuilder.mockReturnValue(
      queryBuilderReturning({ exerciseId: 3, metricTypeId: 7 }),
    );
    metricRepo.createQueryBuilder.mockReturnValue(queryBuilderReturning(null));

    const result = await service.addMetric(10, 'weight', 82.5);

    expect(result).toEqual({
      workoutLogExercise: workoutExercise,
      metricTypeId: 7,
      valueDecimal: 82.5,
    });
    expect(metricRepo.save).toHaveBeenCalledWith(result);
  });

  it('rejects a metric that is not allowed for the exercise', async () => {
    workoutExerciseRepo.findOne.mockResolvedValue({
      id: 10,
      exercise: { id: 3 },
    });
    metricTypeRepo.findOneBy.mockResolvedValue({
      id: 7,
      code: 'weight',
      valueType: MetricValueType.DECIMAL,
    });
    exerciseMetricRepo.createQueryBuilder.mockReturnValue(
      queryBuilderReturning(null),
    );

    await expect(service.addMetric(10, 'weight', 82.5)).rejects.toThrow(
      BadRequestException,
    );

    expect(metricRepo.create).not.toHaveBeenCalled();
    expect(metricRepo.save).not.toHaveBeenCalled();
  });
});
