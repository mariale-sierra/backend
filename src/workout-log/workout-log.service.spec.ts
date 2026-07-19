import { BadRequestException, ConflictException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { RoutineExercise } from '../routine/entities/routine-exercise.entity';
import { WorkoutPostsService } from '../workout-posts/workout-posts.service';
import { WorkoutLogExercise } from './entities/workout-log-exercise.entity';
import { WorkoutLog } from './entities/workout-log.entity';
import { WorkoutLogService } from './workout-log.service';

describe('WorkoutLogService', () => {
  let service: WorkoutLogService;
  let workoutRepo: { findOne: jest.Mock };
  let dataSource: { transaction: jest.Mock };
  let workoutPostsService: { create: jest.Mock };

  beforeEach(async () => {
    workoutRepo = { findOne: jest.fn() };
    dataSource = { transaction: jest.fn() };
    workoutPostsService = { create: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkoutLogService,
        { provide: getRepositoryToken(RoutineExercise), useValue: {} },
        { provide: getRepositoryToken(WorkoutLog), useValue: workoutRepo },
        {
          provide: WorkoutPostsService,
          useValue: workoutPostsService,
        },
        { provide: DataSource, useValue: dataSource },
        { provide: getRepositoryToken(WorkoutLogExercise), useValue: {} },
      ],
    }).compile();

    service = module.get(WorkoutLogService);
  });

  it('requires an image when progress is not a rest day', async () => {
    await expect(
      service.createWorkout({
        userId: 'user-1',
        challengeId: 'challenge-1',
        isRestDay: false,
      }),
    ).rejects.toThrow(BadRequestException);

    expect(workoutRepo.findOne).not.toHaveBeenCalled();
    expect(dataSource.transaction).not.toHaveBeenCalled();
    expect(workoutPostsService.create).not.toHaveBeenCalled();
  });

  it('rejects a second progress entry for the same challenge and day', async () => {
    workoutRepo.findOne.mockResolvedValue({ id: 42 });

    await expect(
      service.createWorkout({
        userId: 'user-1',
        challengeId: 'challenge-1',
        imageUrl: 'https://example.com/progress.jpg',
      }),
    ).rejects.toThrow(ConflictException);

    expect(workoutRepo.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: 'user-1',
          challengeId: 'challenge-1',
        }),
      }),
    );
    expect(dataSource.transaction).not.toHaveBeenCalled();
    expect(workoutPostsService.create).not.toHaveBeenCalled();
  });
});
