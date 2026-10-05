import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { JwtAuthGuard } from './jwt-auth.guard';

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;
  let jwtService: { verifyAsync: jest.Mock };
  let configService: { getOrThrow: jest.Mock };
  let reflector: { getAllAndOverride: jest.Mock };
  let dataSource: { query: jest.Mock };

  const buildContext = (
    headers: Record<string, string> = {},
  ): ExecutionContext => {
    const request: any = { headers, user: undefined };
    return {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    } as unknown as ExecutionContext;
  };

  beforeEach(() => {
    jwtService = { verifyAsync: jest.fn() };
    configService = { getOrThrow: jest.fn().mockReturnValue('test-secret') };
    reflector = { getAllAndOverride: jest.fn().mockReturnValue(false) };
    dataSource = {
      query: jest
        .fn()
        .mockResolvedValue([{ is_active: true, deleted_at: null }]),
    };

    guard = new JwtAuthGuard(
      jwtService as unknown as JwtService,
      configService as unknown as ConfigService,
      reflector as unknown as Reflector,
      dataSource as unknown as DataSource,
    );
  });

  it('should allow the request when the route is marked @Public()', async () => {
    reflector.getAllAndOverride.mockReturnValue(true);
    const context = buildContext();

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(jwtService.verifyAsync).not.toHaveBeenCalled();
  });

  it('should allow the request and attach the payload when the token is valid', async () => {
    const payload = { sub: 'user-1', email: 'a@a.com', username: 'a' };
    jwtService.verifyAsync.mockResolvedValue(payload);
    const context = buildContext({ authorization: 'Bearer valid.token.here' });

    await expect(guard.canActivate(context)).resolves.toBe(true);

    const request = context.switchToHttp().getRequest();
    expect(request.user).toEqual(payload);
    expect(jwtService.verifyAsync).toHaveBeenCalledWith('valid.token.here', {
      secret: 'test-secret',
    });
  });

  it('should reject the request when no Authorization header is present', async () => {
    const context = buildContext();

    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
    expect(jwtService.verifyAsync).not.toHaveBeenCalled();
  });

  it('should reject the request when the Authorization header has no token', async () => {
    const context = buildContext({ authorization: 'Bearer' });

    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('should reject the request when the token is invalid or expired', async () => {
    jwtService.verifyAsync.mockRejectedValue(new Error('jwt expired'));
    const context = buildContext({
      authorization: 'Bearer expired.token.here',
    });

    await expect(guard.canActivate(context)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  describe('account still usable', () => {
    const payload = { sub: 'user-1', email: 'a@a.com', username: 'a' };
    const authed = () =>
      buildContext({ authorization: 'Bearer valid.token.here' });

    beforeEach(() => jwtService.verifyAsync.mockResolvedValue(payload));

    it.each([
      ['no longer exists', []],
      ['was banned', [{ is_active: false, deleted_at: null }]],
      [
        'was purged by account deletion',
        [{ is_active: false, deleted_at: new Date() }],
      ],
    ])(
      'rejects a valid token whose account %s (so the app signs out)',
      async (_label, rows) => {
        dataSource.query.mockResolvedValue(rows);
        await expect(guard.canActivate(authed())).rejects.toThrow(
          'Session is no longer valid',
        );
      },
    );

    it('keeps a pending-deletion account usable (it must be able to cancel)', async () => {
      // deletion_requested_at isn't even read: only banned/purged accounts are cut off.
      dataSource.query.mockResolvedValue([
        { is_active: true, deleted_at: null },
      ]);
      await expect(guard.canActivate(authed())).resolves.toBe(true);
      expect(dataSource.query).toHaveBeenCalledWith(
        'SELECT is_active, deleted_at FROM havit.users WHERE id = $1',
        ['user-1'],
      );
    });

    it('checks the database at most once per user while the answer is fresh', async () => {
      await guard.canActivate(authed());
      await guard.canActivate(authed());
      expect(dataSource.query).toHaveBeenCalledTimes(1);
    });

    it('re-checks after the cache window, catching a ban', async () => {
      jest.useFakeTimers();
      try {
        await guard.canActivate(authed());
        dataSource.query.mockResolvedValue([
          { is_active: false, deleted_at: null },
        ]);
        jest.advanceTimersByTime(30_001);
        await expect(guard.canActivate(authed())).rejects.toThrow(
          UnauthorizedException,
        );
      } finally {
        jest.useRealTimers();
      }
    });

    it('lets the request through if the account lookup itself fails', async () => {
      dataSource.query.mockRejectedValue(new Error('connection reset'));
      await expect(guard.canActivate(authed())).resolves.toBe(true);
    });
  });
});
