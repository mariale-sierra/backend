import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

describe('UsersController', () => {
  let controller: UsersController;
  let service: {
    findById: jest.Mock;
    getUserChallenges: jest.Mock;
  };

  beforeEach(async () => {
    service = {
      findById: jest.fn(),
      getUserChallenges: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [{ provide: UsersService, useValue: service }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: jest.fn().mockReturnValue(true) })
      .compile();

    controller = module.get(UsersController);
    jest.clearAllMocks();
  });

  it('uses the authenticated subject to return the current user', async () => {
    const request = { user: { sub: 'user-1' } };
    const user = { id: 'user-1', username: 'martin' };
    service.findById.mockResolvedValue(user);

    await expect(controller.getMe(request)).resolves.toBe(user);
    expect(service.findById).toHaveBeenCalledWith('user-1');
  });

  it('uses the authenticated subject to return grouped challenges', async () => {
    const request = { user: { sub: 'user-1' } };
    const grouped = { active: [], completed: [], left: [] };
    service.getUserChallenges.mockResolvedValue(grouped);

    await expect(controller.getMyChallenges(request)).resolves.toBe(grouped);
    expect(service.getUserChallenges).toHaveBeenCalledWith('user-1');
  });

  it('propagates service errors', async () => {
    const error = new NotFoundException('User not found');
    service.findById.mockRejectedValue(error);

    await expect(controller.getMe({ user: { sub: 'missing' } })).rejects.toBe(
      error,
    );
  });
});
