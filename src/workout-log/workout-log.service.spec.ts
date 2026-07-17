import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { WorkoutLogService } from './workout-log.service';
import { WorkoutLog } from './entities/workout-log.entity';
import { RoutineExercise } from '../routine/entities/routine-exercise.entity';
import { WorkoutLogExercise } from './entities/workout-log-exercise.entity';
import { WorkoutPostsService } from '../workout-posts/workout-posts.service';

const createMockRepo = () => ({
  find: jest.fn(),
  findOne: jest.fn(),
  findOneBy: jest.fn(),
  save: jest.fn(),
  create: jest.fn((v) => v),
});

describe('WorkoutLogService', () => {
  let service: WorkoutLogService;
  let workoutRepo: ReturnType<typeof createMockRepo>;
  let dataSource: { transaction: jest.Mock };
  let workoutPostsService: { create: jest.Mock };

  const OWNER_ID = 'owner-1';
  const OTHER_USER_ID = 'other-2';

  beforeEach(async () => {
    workoutRepo = createMockRepo();
    dataSource = { transaction: jest.fn() };
    workoutPostsService = { create: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkoutLogService,
        { provide: getRepositoryToken(RoutineExercise), useValue: createMockRepo() },
        { provide: getRepositoryToken(WorkoutLog), useValue: workoutRepo },
        { provide: WorkoutPostsService, useValue: workoutPostsService },
        { provide: DataSource, useValue: dataSource },
        { provide: getRepositoryToken(WorkoutLogExercise), useValue: createMockRepo() },
      ],
    }).compile();

    service = module.get(WorkoutLogService);
  });

  describe('createWorkout', () => {
    it('should reject a second progress log for the same challenge on the same day', async () => {
      workoutRepo.findOne.mockResolvedValue({ id: 1, userId: OWNER_ID, challengeId: 'challenge-1' });

      await expect(
        service.createWorkout({
          userId: OWNER_ID,
          challengeId: 'challenge-1',
          imageUrl: 'https://example.com/x.jpg',
        }),
      ).rejects.toThrow(ConflictException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('should save the workout under the userId passed by the caller (the JWT-derived id)', async () => {
      workoutRepo.findOne.mockResolvedValue(null); // no existing log today
      const createdWorkout = { id: 99, userId: OWNER_ID };
      dataSource.transaction.mockImplementation(async (cb) =>
        cb({
          create: jest.fn().mockReturnValue(createdWorkout),
          save: jest.fn().mockResolvedValue(createdWorkout),
          getRepository: jest.fn(),
        }),
      );
      // findOne is also used at the end (this.findOne(savedWorkout.id))
      workoutRepo.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(createdWorkout);

      await service.createWorkout({
        userId: OWNER_ID,
        challengeId: 'challenge-1',
        imageUrl: 'https://example.com/x.jpg',
      });

      expect(dataSource.transaction).toHaveBeenCalled();
    });
  });

  describe('finishWorkout', () => {
    it('should allow the owner to finish their own workout log', async () => {
      const workout = { id: 1, userId: OWNER_ID, status: 'in_progress' };
      workoutRepo.findOneBy.mockResolvedValue(workout);
      workoutRepo.save.mockImplementation((w) => Promise.resolve(w));

      const result = await service.finishWorkout(1, OWNER_ID);

      expect(result.status).toBe('completed');
      expect(result.ended_at).toBeInstanceOf(Date);
    });

    it('should reject finishing a workout log that belongs to another user', async () => {
      workoutRepo.findOneBy.mockResolvedValue({ id: 1, userId: OWNER_ID, status: 'in_progress' });

      await expect(service.finishWorkout(1, OTHER_USER_ID)).rejects.toThrow(ForbiddenException);
      expect(workoutRepo.save).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException when the workout log does not exist', async () => {
      workoutRepo.findOneBy.mockResolvedValue(null);

      await expect(service.finishWorkout(999, OWNER_ID)).rejects.toThrow(NotFoundException);
    });
  });

  describe('findOne', () => {
    it('should return the workout log when the caller is the owner', async () => {
      const workout = { id: 1, userId: OWNER_ID };
      workoutRepo.findOne.mockResolvedValue(workout);

      await expect(service.findOne(1, OWNER_ID)).resolves.toEqual(workout);
    });

    it('should reject fetching a workout log that belongs to another user', async () => {
      workoutRepo.findOne.mockResolvedValue({ id: 1, userId: OWNER_ID });

      await expect(service.findOne(1, OTHER_USER_ID)).rejects.toThrow(ForbiddenException);
    });

    it('should throw NotFoundException when the workout log does not exist', async () => {
      workoutRepo.findOne.mockResolvedValue(null);

      await expect(service.findOne(999, OWNER_ID)).rejects.toThrow(NotFoundException);
    });
  });

  describe('findAll', () => {
    it('should scope the query to only the requesting user id', async () => {
      workoutRepo.find.mockResolvedValue([]);

      await service.findAll(OWNER_ID);

      expect(workoutRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: OWNER_ID } }),
      );
    });
  });
});
