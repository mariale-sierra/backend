import { ForbiddenException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { SuspensionGuard } from './suspension.guard';

const ctx = (request: Record<string, unknown>) =>
  ({
    switchToHttp: () => ({ getRequest: () => request }),
  }) as unknown as ExecutionContext;

describe('SuspensionGuard', () => {
  const FUTURE = new Date(Date.now() + 3_600_000);
  const PAST = new Date(Date.now() - 3_600_000);
  let query: jest.Mock;
  let guard: SuspensionGuard;

  beforeEach(() => {
    query = jest.fn();
    guard = new SuspensionGuard({ query } as never);
  });

  const write = (url = '/workout-logs/progress') => ({
    method: 'POST',
    originalUrl: url,
    user: { sub: 'u1' },
  });

  it('blocks writes while the suspension is in the future, with the end date', async () => {
    query.mockResolvedValue([{ suspended_until: FUTURE }]);
    await expect(guard.canActivate(ctx(write()))).rejects.toMatchObject({
      response: {
        code: 'ACCOUNT_SUSPENDED',
        suspendedUntil: FUTURE.toISOString(),
      },
    });
    await expect(guard.canActivate(ctx(write()))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('lets writes through once the suspension is over, or when there is none', async () => {
    query.mockResolvedValue([{ suspended_until: PAST }]);
    await expect(guard.canActivate(ctx(write()))).resolves.toBe(true);
    query.mockResolvedValue([{ suspended_until: null }]);
    await expect(guard.canActivate(ctx(write()))).resolves.toBe(true);
  });

  it('never touches reads, public routes, sign-in or notifications (and does not query)', async () => {
    query.mockResolvedValue([{ suspended_until: FUTURE }]);
    await expect(
      guard.canActivate(
        ctx({ method: 'GET', originalUrl: '/feed', user: { sub: 'u1' } }),
      ),
    ).resolves.toBe(true);
    await expect(
      guard.canActivate(ctx({ method: 'POST', originalUrl: '/auth/login' })),
    ).resolves.toBe(true);
    await expect(guard.canActivate(ctx(write('/auth/logout')))).resolves.toBe(
      true,
    );
    await expect(
      guard.canActivate(ctx(write('/notifications/read-all'))),
    ).resolves.toBe(true);
    expect(query).not.toHaveBeenCalled();
  });

  it('lets the request through if the lookup fails', async () => {
    query.mockRejectedValue(new Error('db down'));
    await expect(guard.canActivate(ctx(write()))).resolves.toBe(true);
  });
});
