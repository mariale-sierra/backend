import { WorkoutPostCommentsController } from './workout-post-comments.controller';
import { WorkoutPostCommentsService } from './workout-post-comments.service';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import type { CreateCommentDto } from './dto/create-comment.dto';

describe('WorkoutPostCommentsController', () => {
  let controller: WorkoutPostCommentsController;
  let service: { create: jest.Mock; list: jest.Mock; remove: jest.Mock };

  const user: AuthenticatedUser = {
    sub: 'user-1',
    email: 'u@u.com',
    username: 'u',
  };

  beforeEach(() => {
    service = { create: jest.fn(), list: jest.fn(), remove: jest.fn() };
    controller = new WorkoutPostCommentsController(
      service as unknown as WorkoutPostCommentsService,
    );
  });

  it('create() should delegate to the service with the postId, JWT-derived user id, and comment content', async () => {
    const dto: CreateCommentDto = { content: 'Nice!' };
    service.create.mockResolvedValue({ id: 1, content: 'Nice!' });

    const result = await controller.create('post-1', dto, user);

    expect(service.create).toHaveBeenCalledWith('post-1', 'user-1', 'Nice!');
    expect(result).toEqual({ id: 1, content: 'Nice!' });
  });

  it('list() should delegate to the service with the postId, JWT-derived user id, and pagination options', async () => {
    service.list.mockResolvedValue({ comments: [], nextAfter: null });

    const result = await controller.list(
      'post-1',
      { after: 5, limit: 10 },
      user,
    );

    expect(service.list).toHaveBeenCalledWith('post-1', 'user-1', {
      after: 5,
      limit: 10,
    });
    expect(result).toEqual({ comments: [], nextAfter: null });
  });

  it('remove() should delegate to the service with the postId, commentId, and JWT-derived user id', async () => {
    service.remove.mockResolvedValue({ message: 'Comment deleted' });

    const result = await controller.remove('post-1', 7, user);

    expect(service.remove).toHaveBeenCalledWith('post-1', 7, 'user-1');
    expect(result).toEqual({ message: 'Comment deleted' });
  });
});
