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
import { ExerciseMuscle } from './entities/exercise-muscle.entity';
import { ExerciseTranslation } from './entities/exercise-translation.entity';
import { ExerciseAsset } from './entities/exercise-asset.entity';
import { MuscleRegion } from './entities/muscle-region.entity';
import { Muscle } from './entities/muscle.entity';
import { MuscleSvgPart } from './entities/muscle-svg-part.entity';

const createMockRepo = () => ({
  find: jest.fn().mockResolvedValue([]),
  findOne: jest.fn(),
  findBy: jest.fn(),
  findAndCount: jest.fn().mockResolvedValue([[], 0]),
  save: jest.fn(),
  create: jest.fn((_entity: unknown, data: unknown) => data),
  createQueryBuilder: jest.fn(),
});

describe('ExercisesService', () => {
  let service: ExercisesService;
  let exerciseRepo: ReturnType<typeof createMockRepo>;
  let muscleRepo: ReturnType<typeof createMockRepo>;
  let bodyPartRepo: ReturnType<typeof createMockRepo>;
  let transactionManager: {
    delete: jest.Mock;
    save: jest.Mock;
    create: jest.Mock;
  };

  beforeEach(async () => {
    exerciseRepo = createMockRepo();
    muscleRepo = createMockRepo();
    bodyPartRepo = createMockRepo();
    transactionManager = {
      delete: jest.fn(),
      save: jest.fn(),
      create: jest.fn((_entity: unknown, data: unknown) => data),
    };

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
          useValue: bodyPartRepo,
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
        {
          provide: getRepositoryToken(ExerciseMuscle),
          useValue: createMockRepo(),
        },
        {
          provide: getRepositoryToken(ExerciseTranslation),
          useValue: createMockRepo(),
        },
        {
          provide: getRepositoryToken(ExerciseAsset),
          useValue: createMockRepo(),
        },
        {
          provide: getRepositoryToken(MuscleRegion),
          useValue: createMockRepo(),
        },
        { provide: getRepositoryToken(Muscle), useValue: muscleRepo },
        {
          provide: getRepositoryToken(MuscleSvgPart),
          useValue: createMockRepo(),
        },
        {
          provide: DataSource,
          useValue: {
            transaction: jest.fn(
              async (cb: (manager: unknown) => Promise<unknown>) =>
                cb(transactionManager),
            ),
          },
        },
      ],
    }).compile();

    service = module.get(ExercisesService);
  });

  describe('findAll', () => {
    it('paginates and only lists active exercises', async () => {
      const qb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
      };
      exerciseRepo.createQueryBuilder.mockReturnValue(qb);

      const result = await service.findAll({
        page: 1,
        pageSize: 20,
        locale: 'en',
      });

      expect(qb.where).toHaveBeenCalledWith('exercise.is_active = true');
      expect(result).toEqual({ data: [], page: 1, pageSize: 20, total: 0 });
    });

    it('adds a cross-locale EXISTS search filter when ?search= is given', async () => {
      const qb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
      };
      exerciseRepo.createQueryBuilder.mockReturnValue(qb);

      await service.findAll({
        page: 1,
        pageSize: 20,
        locale: 'en',
        search: 'squat',
      });

      const [sql, params] = qb.andWhere.mock.calls[0] as [string, unknown];
      expect(sql).toContain('exercise_translations');
      expect(sql).not.toContain('locale');
      expect(params).toEqual({ search: '%squat%' });
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

    it('falls back to the base columns when no translation row exists, and to en when the requested locale is missing', async () => {
      exerciseRepo.createQueryBuilder.mockReturnValue(
        queryBuilderReturning({
          id: 1,
          name: 'Push ups',
          slug: 'push-ups',
          description: 'A bodyweight push exercise.',
          instructions: 'Step one\nStep two',
          icon_url: null,
          tracking_mode: 'sets',
          is_active: true,
          regionId: null,
          exercise_metrics: [],
        }),
      );

      const result = await service.findFullById(1, 'de');

      expect(result.name).toBe('Push ups');
      expect(result.instructions).toEqual(['Step one', 'Step two']);
    });
  });

  describe('countMatchingExercises', () => {
    function queryBuilderReturning(count: number) {
      const qb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getCount: jest.fn().mockResolvedValue(count),
      };
      exerciseRepo.createQueryBuilder.mockReturnValue(qb);
      return qb;
    }

    it('should count only active exercises when no filters are given', async () => {
      const qb = queryBuilderReturning(13);

      const result = await service.countMatchingExercises([], []);

      expect(result).toBe(13);
      expect(qb.where).toHaveBeenCalledWith('exercise.is_active = true');
      expect(qb.andWhere).not.toHaveBeenCalled();
    });

    it('should add an EXISTS filter for categories, lower-casing the given names', async () => {
      const qb = queryBuilderReturning(4);

      await service.countMatchingExercises(['Cardio Intense'], []);

      const [sql, params] = qb.andWhere.mock.calls[0] as [string, unknown];
      expect(sql).toContain('exercise_category_map');
      expect(sql).toContain('LOWER(ec.name) IN (:...categoryNames)');
      expect(params).toEqual({ categoryNames: ['cardio intense'] });
    });

    it('should add an EXISTS filter for locations, lower-casing the given names', async () => {
      const qb = queryBuilderReturning(2);

      await service.countMatchingExercises([], ['Gym', 'Outdoor']);

      const [sql, params] = qb.andWhere.mock.calls[0] as [string, unknown];
      expect(sql).toContain('exercise_location_map');
      expect(sql).toContain('LOWER(el.name) IN (:...locationNames)');
      expect(params).toEqual({ locationNames: ['gym', 'outdoor'] });
    });

    it('should apply both filters together when categories and locations are both given', async () => {
      const qb = queryBuilderReturning(1);

      await service.countMatchingExercises(['Strength'], ['Gym']);

      expect(qb.andWhere).toHaveBeenCalledTimes(2);
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

    it("sets relationType='primary' on body-part inserts (regression: this used to be omitted entirely, even though the column is NOT NULL)", async () => {
      exerciseRepo.findOne.mockResolvedValue({ id: 123 });
      bodyPartRepo.find.mockResolvedValue([{ id: 3 }, { id: 4 }]);

      await service.updateRelations(123, { bodyPartIds: [3, 4] });

      expect(transactionManager.save).toHaveBeenCalledWith([
        { exerciseId: 123, bodyPartId: 3, relationType: 'primary' },
        { exerciseId: 123, bodyPartId: 4, relationType: 'primary' },
      ]);
    });

    it('validates muscle ids and writes muscleAssignments with their role', async () => {
      exerciseRepo.findOne.mockResolvedValue({ id: 123 });
      muscleRepo.find.mockResolvedValue([{ id: 5 }, { id: 6 }]);

      await service.updateRelations(123, {
        muscleAssignments: [
          { muscleId: 5, role: 'primary' },
          { muscleId: 6, role: 'secondary' },
        ],
      });

      expect(transactionManager.save).toHaveBeenCalledWith([
        { exerciseId: 123, muscleId: 5, role: 'primary' },
        { exerciseId: 123, muscleId: 6, role: 'secondary' },
      ]);
    });

    it('rejects an unknown muscle id', async () => {
      exerciseRepo.findOne.mockResolvedValue({ id: 123 });
      muscleRepo.find.mockResolvedValue([{ id: 5 }]);

      await expect(
        service.updateRelations(123, {
          muscleAssignments: [{ muscleId: 999, role: 'primary' }],
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
