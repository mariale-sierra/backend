import { FollowsController } from './follows.controller';
import { FollowsService } from './follows.service';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';

describe('FollowsController', () => {
  let controller: FollowsController;
  let service: {
    follow: jest.Mock;
    unfollow: jest.Mock;
    listFollowers: jest.Mock;
    listFollowing: jest.Mock;
    getFriendStreaks: jest.Mock;
  };

  const currentUser: AuthenticatedUser = {
    sub: 'user-1',
    email: 'user1@example.com',
    username: 'user1',
  };

  beforeEach(() => {
    service = {
      follow: jest.fn().mockResolvedValue({ message: 'Now following user' }),
      unfollow: jest
        .fn()
        .mockResolvedValue({ message: 'Unfollowed user successfully' }),
      listFollowers: jest.fn().mockResolvedValue([]),
      listFollowing: jest.fn().mockResolvedValue([]),
      getFriendStreaks: jest.fn().mockResolvedValue([]),
    };

    controller = new FollowsController(service as unknown as FollowsService);
  });

  it('should follow a user on behalf of the authenticated caller, never the path param as the follower', async () => {
    await controller.follow('user-2', currentUser);

    expect(service.follow).toHaveBeenCalledWith('user-1', 'user-2');
  });

  it('should unfollow a user on behalf of the authenticated caller', async () => {
    await controller.unfollow('user-2', currentUser);

    expect(service.unfollow).toHaveBeenCalledWith('user-1', 'user-2');
  });

  it('should list followers scoped to the authenticated caller, not a path param', async () => {
    await controller.getFollowers(currentUser);

    expect(service.listFollowers).toHaveBeenCalledWith('user-1');
  });

  it('should list following scoped to the authenticated caller, not a path param', async () => {
    await controller.getFollowing(currentUser);

    expect(service.listFollowing).toHaveBeenCalledWith('user-1');
  });

  it('should get friend streaks scoped to the authenticated caller, not a path param', async () => {
    await controller.getFollowingStreaks(currentUser);

    expect(service.getFriendStreaks).toHaveBeenCalledWith('user-1');
  });
});
