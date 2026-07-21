import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { UpdateExerciseRelationsDto } from './dto/update-exercise-relations.dto';
import { ExercisesController } from './exercises.controller';
import { ExercisesService } from './exercises.service';

describe('ExercisesController', () => {
  let controller: ExercisesController;
  let service: {
    create: jest.Mock;
    findAll: jest.Mock;
    findFullById: jest.Mock;
    updateRelations: jest.Mock;
  };

  beforeEach(async () => {
    service = {
      create: jest.fn(),
      findAll: jest.fn(),
      findFullById: jest.fn(),
      updateRelations: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ExercisesController],
      providers: [{ provide: ExercisesService, useValue: service }],
    }).compile();

    controller = module.get(ExercisesController);
    jest.clearAllMocks();
  });

  it('delegates exercise creation and returns the service result', async () => {
    const body = { name: 'Squat', slug: 'squat' };
    const created = { id: 1, ...body };
    service.create.mockResolvedValue(created);

    await expect(controller.create(body)).resolves.toBe(created);
    expect(service.create).toHaveBeenCalledWith(body);
  });

  it('returns all exercises from the service', async () => {
    const exercises = [{ id: 1, name: 'Squat' }];
    service.findAll.mockResolvedValue(exercises);

    await expect(controller.findAll()).resolves.toBe(exercises);
    expect(service.findAll).toHaveBeenCalledTimes(1);
  });

  it('delegates the numeric id when requesting a full exercise', async () => {
    const exercise = { id: 7, metrics: [] };
    service.findFullById.mockResolvedValue(exercise);

    await expect(controller.findFullById(7)).resolves.toBe(exercise);
    expect(service.findFullById).toHaveBeenCalledWith(7);
  });

  it('delegates relation updates without altering the dto', async () => {
    const dto: UpdateExerciseRelationsDto = {
      categoryIds: [1, 2],
      primaryCategoryId: 1,
    };
    const result = { message: 'updated' };
    service.updateRelations.mockResolvedValue(result);

    await expect(controller.updateRelations(4, dto)).resolves.toBe(result);
    expect(service.updateRelations).toHaveBeenCalledWith(4, dto);
  });

  it('propagates service errors', async () => {
    const error = new NotFoundException('Exercise not found');
    service.findFullById.mockRejectedValue(error);

    await expect(controller.findFullById(99)).rejects.toBe(error);
  });
});
