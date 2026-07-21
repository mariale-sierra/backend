import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, In } from 'typeorm';
import { ExerciseBodyPartMap } from './entities/exercise-body-part-map.entity';
import { ExerciseBodyPart } from './entities/exercise-body-part.entity';
import { ExerciseCategoryMap } from './entities/exercise-category-map.entity';
import { ExerciseCategory } from './entities/exercise-category.entity';
import { ExerciseLocationMap } from './entities/exercise-location-map.entity';
import { ExerciseLocation } from './entities/exercise-location.entity';
import { Exercise, TrackingMode } from './entities/exercise.entity';
import { ExercisesService } from './exercises.service';

const createRepositoryMock = () => ({
  create: jest.fn(),
  save: jest.fn(),
  find: jest.fn(),
  findOne: jest.fn(),
  createQueryBuilder: jest.fn(),
});

const createQueryBuilderMock = () => {
  const queryBuilder = {
    leftJoinAndSelect: jest.fn(),
    where: jest.fn(),
    andWhere: jest.fn(),
    orderBy: jest.fn(),
    addOrderBy: jest.fn(),
    getOne: jest.fn(),
  };

  queryBuilder.leftJoinAndSelect.mockReturnValue(queryBuilder);
  queryBuilder.where.mockReturnValue(queryBuilder);
  queryBuilder.andWhere.mockReturnValue(queryBuilder);
  queryBuilder.orderBy.mockReturnValue(queryBuilder);
  queryBuilder.addOrderBy.mockReturnValue(queryBuilder);
  return queryBuilder;
};

describe('ExercisesService', () => {
  let service: ExercisesService;
  let exerciseRepo: ReturnType<typeof createRepositoryMock>;
  let categoryRepo: ReturnType<typeof createRepositoryMock>;
  let locationRepo: ReturnType<typeof createRepositoryMock>;
  let bodyPartRepo: ReturnType<typeof createRepositoryMock>;
  let categoryMapRepo: ReturnType<typeof createRepositoryMock>;
  let locationMapRepo: ReturnType<typeof createRepositoryMock>;
  let bodyPartMapRepo: ReturnType<typeof createRepositoryMock>;
  let dataSource: { transaction: jest.Mock };
  let manager: {
    delete: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };

  beforeEach(async () => {
    exerciseRepo = createRepositoryMock();
    categoryRepo = createRepositoryMock();
    locationRepo = createRepositoryMock();
    bodyPartRepo = createRepositoryMock();
    categoryMapRepo = createRepositoryMock();
    locationMapRepo = createRepositoryMock();
    bodyPartMapRepo = createRepositoryMock();
    manager = {
      delete: jest.fn(),
      create: jest.fn((_entity: unknown, data: unknown) => data),
      save: jest.fn(),
    };
    dataSource = { transaction: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExercisesService,
        { provide: DataSource, useValue: dataSource },
        { provide: getRepositoryToken(Exercise), useValue: exerciseRepo },
        {
          provide: getRepositoryToken(ExerciseCategory),
          useValue: categoryRepo,
        },
        {
          provide: getRepositoryToken(ExerciseLocation),
          useValue: locationRepo,
        },
        {
          provide: getRepositoryToken(ExerciseBodyPart),
          useValue: bodyPartRepo,
        },
        {
          provide: getRepositoryToken(ExerciseCategoryMap),
          useValue: categoryMapRepo,
        },
        {
          provide: getRepositoryToken(ExerciseLocationMap),
          useValue: locationMapRepo,
        },
        {
          provide: getRepositoryToken(ExerciseBodyPartMap),
          useValue: bodyPartMapRepo,
        },
      ],
    }).compile();

    service = module.get(ExercisesService);
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('creates and saves an exercise', async () => {
      const dto = { name: 'Squat', slug: 'squat' };
      const entity = { ...dto, id: 1 };
      exerciseRepo.create.mockReturnValue(entity);
      exerciseRepo.save.mockResolvedValue(entity);

      await expect(service.create(dto)).resolves.toBe(entity);
      expect(exerciseRepo.create).toHaveBeenCalledWith(dto);
      expect(exerciseRepo.save).toHaveBeenCalledWith(entity);
    });

    it('propagates repository errors', async () => {
      const error = new Error('save failed');
      exerciseRepo.create.mockReturnValue({ name: 'Squat' });
      exerciseRepo.save.mockRejectedValue(error);

      await expect(service.create({ name: 'Squat' })).rejects.toBe(error);
    });
  });

  it('findAll requests only active exercises', async () => {
    const exercises = [{ id: 1, is_active: true }];
    exerciseRepo.find.mockResolvedValue(exercises);

    await expect(service.findAll()).resolves.toBe(exercises);
    expect(exerciseRepo.find).toHaveBeenCalledWith({
      where: { is_active: true },
    });
  });

  describe('findFullById', () => {
    it('builds the query and transforms exercise metrics', async () => {
      const queryBuilder = createQueryBuilderMock();
      const exercise = {
        id: 7,
        name: 'Squat',
        slug: 'squat',
        description: 'Description',
        instructions: 'Instructions',
        icon_url: 'icon.png',
        tracking_mode: TrackingMode.SETS,
        is_active: true,
        exercise_metrics: [
          {
            defaultUnit: 'kg',
            isRequired: true,
            isPrimary: true,
            metricType: {
              id: 2,
              code: 'weight',
              name: 'Weight',
              valueType: 'decimal',
              defaultUnit: 'lb',
              description: 'Lifted weight',
            },
          },
          {
            defaultUnit: undefined,
            isRequired: false,
            isPrimary: false,
            metricType: {
              id: 3,
              code: 'reps',
              name: 'Repetitions',
              valueType: 'int',
              defaultUnit: 'rep',
              description: 'Repetitions',
            },
          },
        ],
      };
      exerciseRepo.createQueryBuilder.mockReturnValue(queryBuilder);
      queryBuilder.getOne.mockResolvedValue(exercise);

      await expect(service.findFullById(7)).resolves.toEqual({
        id: 7,
        name: 'Squat',
        slug: 'squat',
        description: 'Description',
        instructions: 'Instructions',
        icon_url: 'icon.png',
        tracking_mode: TrackingMode.SETS,
        is_active: true,
        metrics: [
          {
            id: 2,
            code: 'weight',
            name: 'Weight',
            valueType: 'decimal',
            defaultUnit: 'kg',
            description: 'Lifted weight',
            isRequired: true,
            isPrimary: true,
          },
          {
            id: 3,
            code: 'reps',
            name: 'Repetitions',
            valueType: 'int',
            defaultUnit: 'rep',
            description: 'Repetitions',
            isRequired: false,
            isPrimary: false,
          },
        ],
      });
      expect(exerciseRepo.createQueryBuilder).toHaveBeenCalledWith('exercise');
      expect(queryBuilder.leftJoinAndSelect).toHaveBeenNthCalledWith(
        1,
        'exercise.exercise_metrics',
        'exerciseMetric',
      );
      expect(queryBuilder.leftJoinAndSelect).toHaveBeenNthCalledWith(
        2,
        'exerciseMetric.metricType',
        'metricType',
      );
      expect(queryBuilder.where).toHaveBeenCalledWith('exercise.id = :id', {
        id: 7,
      });
      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        'exercise.is_active = :isActive',
        { isActive: true },
      );
      expect(queryBuilder.orderBy).toHaveBeenCalledWith(
        'exerciseMetric.isPrimary',
        'DESC',
      );
      expect(queryBuilder.addOrderBy).toHaveBeenCalledWith(
        'metricType.name',
        'ASC',
      );
    });

    it('returns an empty metrics array when no metrics are loaded', async () => {
      const queryBuilder = createQueryBuilderMock();
      exerciseRepo.createQueryBuilder.mockReturnValue(queryBuilder);
      queryBuilder.getOne.mockResolvedValue({
        id: 1,
        is_active: true,
        exercise_metrics: undefined,
      });

      await expect(service.findFullById(1)).resolves.toMatchObject({
        id: 1,
        metrics: [],
      });
    });

    it('throws NotFoundException when the active exercise does not exist', async () => {
      const queryBuilder = createQueryBuilderMock();
      exerciseRepo.createQueryBuilder.mockReturnValue(queryBuilder);
      queryBuilder.getOne.mockResolvedValue(null);

      const action = service.findFullById(99);

      await expect(action).rejects.toBeInstanceOf(NotFoundException);
      await expect(action).rejects.toThrow('Exercise with id 99 not found');
    });
  });

  describe('updateRelations', () => {
    beforeEach(() => {
      exerciseRepo.findOne.mockResolvedValue({ id: 4 });
      categoryRepo.find.mockResolvedValue([]);
      locationRepo.find.mockResolvedValue([]);
      bodyPartRepo.find.mockResolvedValue([]);
      categoryMapRepo.find.mockResolvedValue([]);
      locationMapRepo.find.mockResolvedValue([]);
      bodyPartMapRepo.find.mockResolvedValue([]);
      dataSource.transaction.mockImplementation(
        async (
          callback: (transactionManager: typeof manager) => Promise<unknown>,
        ) => callback(manager),
      );
    });

    it('throws NotFoundException when the exercise does not exist', async () => {
      exerciseRepo.findOne.mockResolvedValue(null);

      const action = service.updateRelations(99, { bodyPartIds: [] });

      await expect(action).rejects.toBeInstanceOf(NotFoundException);
      await expect(action).rejects.toThrow('Exercise with id 99 not found');
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it.each([
      [{}, 'At least one relation list is required'],
      [
        { primaryCategoryId: 1 },
        'Primary category cannot be set without category ids',
      ],
      [
        { categoryIds: [], primaryCategoryId: 1 },
        'Primary category cannot be set when the category list is empty',
      ],
      [
        { categoryIds: [1] },
        'A primary category is required when saving category relations',
      ],
      [
        { categoryIds: [1], primaryCategoryId: 2 },
        'Primary category must be one of the selected category ids',
      ],
      [
        { locationIds: [3], primaryLocationId: 4 },
        'Primary location must be one of the selected location ids',
      ],
    ])('rejects invalid relation selections %#', async (dto, message) => {
      const action = service.updateRelations(4, dto);

      await expect(action).rejects.toBeInstanceOf(BadRequestException);
      await expect(action).rejects.toThrow(message);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('rejects lookup ids that do not exist', async () => {
      categoryRepo.find.mockResolvedValue([{ id: 1 }]);

      const action = service.updateRelations(4, {
        categoryIds: [1, 2],
        primaryCategoryId: 1,
      });

      await expect(action).rejects.toBeInstanceOf(BadRequestException);
      await expect(action).rejects.toThrow('Invalid category ids: 2');
      expect(categoryRepo.find).toHaveBeenCalledWith({
        where: { id: In([1, 2]) },
      });
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('rejects location ids that do not exist', async () => {
      locationRepo.find.mockResolvedValue([{ id: 3 }]);

      const action = service.updateRelations(4, {
        locationIds: [3, 4],
        primaryLocationId: 3,
      });

      await expect(action).rejects.toBeInstanceOf(BadRequestException);
      await expect(action).rejects.toThrow('Invalid location ids: 4');
      expect(locationRepo.find).toHaveBeenCalledWith({
        where: { id: In([3, 4]) },
      });
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('rejects body part ids that do not exist', async () => {
      bodyPartRepo.find.mockResolvedValue([{ id: 5 }]);

      const action = service.updateRelations(4, {
        bodyPartIds: [5, 6],
      });

      await expect(action).rejects.toBeInstanceOf(BadRequestException);
      await expect(action).rejects.toThrow('Invalid body part ids: 6');
      expect(bodyPartRepo.find).toHaveBeenCalledWith({
        where: { id: In([5, 6]) },
      });
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('replaces selected relations in one transaction and returns grouped data', async () => {
      categoryRepo.find.mockResolvedValue([{ id: 1 }, { id: 2 }]);
      locationRepo.find.mockResolvedValue([{ id: 3 }]);
      bodyPartRepo.find.mockResolvedValue([{ id: 4 }]);
      categoryMapRepo.find.mockResolvedValue([
        { category: { id: 1, name: 'Strength' } },
      ]);
      locationMapRepo.find.mockResolvedValue([
        { location: { id: 3, name: 'Gym' } },
      ]);
      bodyPartMapRepo.find.mockResolvedValue([
        { bodyPart: { id: 4, name: 'Legs' } },
      ]);
      const categoryMaps = [
        { exerciseId: 4, categoryId: 1, isPrimary: false },
        { exerciseId: 4, categoryId: 2, isPrimary: true },
      ];
      const locationMaps = [{ exerciseId: 4, locationId: 3, isPrimary: true }];
      const bodyPartMaps = [{ exerciseId: 4, bodyPartId: 4 }];

      await expect(
        service.updateRelations(4, {
          categoryIds: [1, 2],
          primaryCategoryId: 2,
          locationIds: [3],
          primaryLocationId: 3,
          bodyPartIds: [4],
        }),
      ).resolves.toEqual({
        message: 'Exercise relations updated successfully',
        data: {
          exerciseId: 4,
          categories: [{ id: 1, name: 'Strength' }],
          locations: [{ id: 3, name: 'Gym' }],
          bodyParts: [{ id: 4, name: 'Legs' }],
        },
      });
      expect(categoryRepo.find).toHaveBeenCalledWith({
        where: { id: In([1, 2]) },
      });
      expect(locationRepo.find).toHaveBeenCalledWith({
        where: { id: In([3]) },
      });
      expect(bodyPartRepo.find).toHaveBeenCalledWith({
        where: { id: In([4]) },
      });
      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
      expect(manager.delete).toHaveBeenCalledTimes(3);
      expect(manager.delete).toHaveBeenNthCalledWith(1, ExerciseCategoryMap, {
        exerciseId: 4,
      });
      expect(manager.delete).toHaveBeenNthCalledWith(2, ExerciseLocationMap, {
        exerciseId: 4,
      });
      expect(manager.delete).toHaveBeenNthCalledWith(3, ExerciseBodyPartMap, {
        exerciseId: 4,
      });
      expect(manager.create).toHaveBeenCalledTimes(4);
      expect(manager.create).toHaveBeenCalledWith(
        ExerciseCategoryMap,
        categoryMaps[0],
      );
      expect(manager.create).toHaveBeenCalledWith(ExerciseCategoryMap, {
        exerciseId: 4,
        categoryId: 2,
        isPrimary: true,
      });
      expect(manager.create).toHaveBeenCalledWith(ExerciseLocationMap, {
        exerciseId: 4,
        locationId: 3,
        isPrimary: true,
      });
      expect(manager.create).toHaveBeenCalledWith(ExerciseBodyPartMap, {
        exerciseId: 4,
        bodyPartId: 4,
      });
      expect(manager.save).toHaveBeenCalledTimes(3);
      expect(manager.save).toHaveBeenNthCalledWith(1, categoryMaps);
      expect(manager.save).toHaveBeenNthCalledWith(2, locationMaps);
      expect(manager.save).toHaveBeenNthCalledWith(3, bodyPartMaps);
    });

    it('clears empty relation lists without creating or saving maps', async () => {
      await service.updateRelations(4, {
        categoryIds: [],
        locationIds: [],
        bodyPartIds: [],
      });

      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
      expect(manager.delete).toHaveBeenNthCalledWith(1, ExerciseCategoryMap, {
        exerciseId: 4,
      });
      expect(manager.delete).toHaveBeenNthCalledWith(2, ExerciseLocationMap, {
        exerciseId: 4,
      });
      expect(manager.delete).toHaveBeenNthCalledWith(3, ExerciseBodyPartMap, {
        exerciseId: 4,
      });
      expect(manager.create).not.toHaveBeenCalled();
      expect(manager.save).not.toHaveBeenCalled();
    });

    it('does not modify omitted relation types', async () => {
      await service.updateRelations(4, { categoryIds: [] });

      expect(manager.delete).toHaveBeenCalledTimes(1);
      expect(manager.delete).toHaveBeenCalledWith(ExerciseCategoryMap, {
        exerciseId: 4,
      });
      expect(manager.delete).not.toHaveBeenCalledWith(
        ExerciseLocationMap,
        expect.anything(),
      );
      expect(manager.delete).not.toHaveBeenCalledWith(
        ExerciseBodyPartMap,
        expect.anything(),
      );
      expect(manager.create).not.toHaveBeenCalled();
      expect(manager.save).not.toHaveBeenCalled();
    });

    it('propagates transaction errors and does not load final relations', async () => {
      const error = new Error('transaction failed');
      dataSource.transaction.mockRejectedValue(error);

      await expect(
        service.updateRelations(4, { bodyPartIds: [] }),
      ).rejects.toBe(error);
      expect(categoryMapRepo.find).not.toHaveBeenCalled();
    });
  });
});
