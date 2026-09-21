import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { AdminGuard } from './admin.guard';

describe('AdminGuard', () => {
  let guard: AdminGuard;
  let userRepo: { findOne: jest.Mock };

  const buildContext = (user?: { sub: string }): ExecutionContext => {
    const request: any = { user };
    return {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    } as unknown as ExecutionContext;
  };

  beforeEach(() => {
    userRepo = { findOne: jest.fn() };
    guard = new AdminGuard(userRepo as any);
  });

  it('should allow the request when the JWT-authenticated user is an admin', async () => {
    userRepo.findOne.mockResolvedValue({ id: 'user-1', is_admin: true });
    const context = buildContext({ sub: 'user-1' });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(userRepo.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'user-1' } }),
    );
  });

  // The whole point of this guard: admin status is looked up fresh from the
  // DB every time, never trusted from the JWT payload itself (which never
  // carries is_admin at all — see AuthService.signToken).
  it('should reject a non-admin user', async () => {
    userRepo.findOne.mockResolvedValue({ id: 'user-1', is_admin: false });
    const context = buildContext({ sub: 'user-1' });

    await expect(guard.canActivate(context)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('should reject when the user no longer exists', async () => {
    userRepo.findOne.mockResolvedValue(null);
    const context = buildContext({ sub: 'deleted-user' });

    await expect(guard.canActivate(context)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('should reject when there is no authenticated user on the request at all', async () => {
    const context = buildContext(undefined);

    await expect(guard.canActivate(context)).rejects.toThrow(
      ForbiddenException,
    );
    expect(userRepo.findOne).not.toHaveBeenCalled();
  });
});
