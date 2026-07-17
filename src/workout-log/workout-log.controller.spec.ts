import { WorkoutLogController } from './workout-log.controller';
import { WorkoutLogService } from './workout-log.service';
import { CreateWorkoutLogDto } from './dto/create-workout-log.dto';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';

describe('WorkoutLogController', () => {
  let controller: WorkoutLogController;
  let service: { createWorkout: jest.Mock; findAll: jest.Mock; findOne: jest.Mock; finishWorkout: jest.Mock };

  const user: AuthenticatedUser = { sub: 'jwt-user-1', email: 'a@a.com', username: 'a' };

  beforeEach(() => {
    service = {
      createWorkout: jest.fn(),
      findAll: jest.fn(),
      findOne: jest.fn(),
      finishWorkout: jest.fn(),
    };
    controller = new WorkoutLogController(service as unknown as WorkoutLogService);
  });

  describe('create', () => {
    it('should derive userId from the authenticated JWT user, ignoring any userId sent in the body', async () => {
      const spoofedBody: CreateWorkoutLogDto = {
        routineId: 42,
        // Attempt to impersonate another user via the request body.
        userId: 'attacker-controlled-id',
      } as CreateWorkoutLogDto;

      await controller.create(spoofedBody, user);

      expect(service.createWorkout).toHaveBeenCalledWith({
        routineId: 42,
        userId: 'jwt-user-1',
      });
      expect(service.createWorkout).not.toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'attacker-controlled-id' }),
      );
    });
  });

  describe('findAll', () => {
    it('should scope the list to the authenticated caller only', async () => {
      await controller.findAll(user);

      expect(service.findAll).toHaveBeenCalledWith('jwt-user-1');
    });
  });

  describe('findOne', () => {
    it('should pass the authenticated user id so the service can enforce ownership', async () => {
      await controller.findOne('7', user);

      expect(service.findOne).toHaveBeenCalledWith(7, 'jwt-user-1');
    });
  });

  describe('finish', () => {
    it('should pass the authenticated user id so the service can enforce ownership', async () => {
      await controller.finish('7', user);

      expect(service.finishWorkout).toHaveBeenCalledWith(7, 'jwt-user-1');
    });
  });
});
