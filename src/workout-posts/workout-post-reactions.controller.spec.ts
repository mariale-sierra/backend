import { WorkoutPostReactionsController } from './workout-post-reactions.controller';
import { WorkoutPostReactionsService } from './workout-post-reactions.service';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';

describe('WorkoutPostReactionsController', () => {
  let controller: WorkoutPostReactionsController;
  let service: {
    react: jest.Mock;
    unreact: jest.Mock;
    getSummary: jest.Mock;
  };

  const user: AuthenticatedUser = {
    sub: 'user-1',
    email: 'u@u.com',
    username: 'u',
  };

  beforeEach(() => {
    service = {
      react: jest.fn(),
      unreact: jest.fn(),
      getSummary: jest.fn(),
    };
    controller = new WorkoutPostReactionsController(
      service as unknown as WorkoutPostReactionsService,
    );
  });

  it('react() should delegate to the service with the postId and the JWT-derived user id', async () => {
    service.react.mockResolvedValue({ message: 'Reaction added' });

    const result = await controller.react('post-1', user);

    expect(service.react).toHaveBeenCalledWith('post-1', 'user-1');
    expect(result).toEqual({ message: 'Reaction added' });
  });

  it('unreact() should delegate to the service with the postId and the JWT-derived user id', async () => {
    service.unreact.mockResolvedValue({ message: 'Reaction removed' });

    const result = await controller.unreact('post-1', user);

    expect(service.unreact).toHaveBeenCalledWith('post-1', 'user-1');
    expect(result).toEqual({ message: 'Reaction removed' });
  });

  it('getSummary() should delegate to the service with the postId and the JWT-derived user id', async () => {
    service.getSummary.mockResolvedValue({ count: 3, reactedByMe: true });

    const result = await controller.getSummary('post-1', user);

    expect(service.getSummary).toHaveBeenCalledWith('post-1', 'user-1');
    expect(result).toEqual({ count: 3, reactedByMe: true });
  });
});
