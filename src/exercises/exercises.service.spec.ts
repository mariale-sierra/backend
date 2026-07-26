import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ExercisesService } from './exercises.service';
import { Exercise } from './entities/exercise.entity';
import { ExerciseCategory } from './entities/exercise-category.entity';
import { ExerciseLocation } from './entities/exercise-location.entity';
import { ExerciseBodyPart } from './entities/exercise-body-part.entity';
import { ExerciseCategoryMap } from './entities/exercise-category-map.entity';
import { ExerciseLocationMap } from './entities/exercise-location-map.entity';
import { ExerciseBodyPartMap } from './entities/exercise-body-part-map.entity';

const createMockRepo = () => ({
  find: jest.fn(),
  findOne: jest.fn(),
  findBy: jest.fn(),
  save: jest.fn(),
  create: jest.fn(),
  createQueryBuilder: jest.fn(),
});

describe('ExercisesService', () => {
  let service: ExercisesService;
  let exerciseRepo: ReturnType<typeof createMockRepo>;

  beforeEach(async () => {
    exerciseRepo = createMockRepo();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExercisesService,
        { provide: getRepositoryToken(Exercise), useValue: exerciseRepo },
        {
          provide: getRepositoryToken(ExerciseCategory),
          useValue: createMockRepo(),
        },
        {
          provide: getRepositoryToken(ExerciseLocation),
          useValue: createMockRepo(),
        },
        {
          provide: getRepositoryToken(ExerciseBodyPart),
          useValue: createMockRepo(),
        },
        {
          provide: getRepositoryToken(ExerciseCategoryMap),
          useValue: createMockRepo(),
        },
        {
          provide: getRepositoryToken(ExerciseLocationMap),
          useValue: createMockRepo(),
        },
        {
          provide: getRepositoryToken(ExerciseBodyPartMap),
          useValue: createMockRepo(),
        },
        { provide: DataSource, useValue: { transaction: jest.fn() } },
      ],
    }).compile();

    service = module.get(ExercisesService);
  });

  describe('findAll', () => {
    it('should only list active exercises', async () => {
      exerciseRepo.find.mockResolvedValue([]);

      await service.findAll();

      expect(exerciseRepo.find).toHaveBeenCalledWith({
        where: { is_active: true },
      });
    });
  });

  describe('findFullById', () => {
    const queryBuilderReturning = (result: unknown) => ({
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(result),
    });

    it('should throw NotFoundException when the exercise does not exist or is inactive', async () => {
      exerciseRepo.createQueryBuilder.mockReturnValue(
        queryBuilderReturning(null),
      );

      await expect(service.findFullById(999)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should flatten metric types into the response shape', async () => {
      exerciseRepo.createQueryBuilder.mockReturnValue(
        queryBuilderReturning({
          id: 1,
          name: 'Push ups',
          slug: 'push-ups',
          description: null,
          instructions: null,
          icon_url: null,
          tracking_mode: 'reps',
          is_active: true,
          exercise_metrics: [
            {
              isRequired: true,
              isPrimary: true,
              defaultUnit: null,
              metricType: {
                id: 10,
                code: 'reps',
                name: 'Repetitions',
                valueType: 'integer',
                defaultUnit: 'reps',
                description: null,
              },
            },
          ],
        }),
      );

      const result = await service.findFullById(1);

      expect(result.metrics).toEqual([
        expect.objectContaining({
          code: 'reps',
          isPrimary: true,
          // falls back to the metric type default when the relation has none
          defaultUnit: 'reps',
        }),
      ]);
    });
  });

  describe('updateRelations', () => {
    it('should throw NotFoundException for an unknown exercise', async () => {
      exerciseRepo.findOne.mockResolvedValue(null);

      await expect(
        service.updateRelations(123, { categoryIds: [1] }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should reject a request without any relation list', async () => {
      exerciseRepo.findOne.mockResolvedValue({ id: 123 });

      await expect(service.updateRelations(123, {})).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should reject a primary category that is not part of the submitted list', async () => {
      exerciseRepo.findOne.mockResolvedValue({ id: 123 });

      await expect(
        service.updateRelations(123, {
          categoryIds: [1, 2],
          primaryCategoryId: 99,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
