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
    // The session cache is shared by every guard instance in the process.
    JwtAuthGuard.clearSessionCache();
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

  // B4: a token with a `sid` is tied to its refresh token family.
  describe('session (sid) still alive', () => {
    const sid = '7d0f3a52-9b8e-4c1d-a6f2-3e5b8c9d0a1b';
    const payload = { sub: 'user-1', email: 'a@a.com', username: 'a', sid };
    const authed = () =>
      buildContext({ authorization: 'Bearer valid.token.here' });

    beforeEach(() => {
      jwtService.verifyAsync.mockResolvedValue(payload);
      dataSource.query.mockResolvedValue([
        { is_active: true, deleted_at: null, session_active: true },
      ]);
    });

    it('checks the account and the session in the same lookup', async () => {
      await expect(guard.canActivate(authed())).resolves.toBe(true);
      expect(dataSource.query).toHaveBeenCalledTimes(1);
      const [sql, params] = dataSource.query.mock.calls[0];
      expect(sql).toContain('havit.refresh_tokens');
      expect(sql).toContain('replaced_by IS NULL');
      expect(sql).toContain('revoked_at IS NULL');
      expect(params).toEqual(['user-1', sid]);
    });

    it('rejects an access token whose session was logged out or revoked', async () => {
      dataSource.query.mockResolvedValue([
        { is_active: true, deleted_at: null, session_active: false },
      ]);
      await expect(guard.canActivate(authed())).rejects.toThrow(
        'Session is no longer valid',
      );
    });

    it('cuts a cached session off immediately once it is forgotten (logout on this instance)', async () => {
      await guard.canActivate(authed());
      dataSource.query.mockResolvedValue([
        { is_active: true, deleted_at: null, session_active: false },
      ]);
      // Still cached: no new lookup.
      await expect(guard.canActivate(authed())).resolves.toBe(true);

      JwtAuthGuard.forgetSession(sid);

      await expect(guard.canActivate(authed())).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('catches a revocation made elsewhere after the cache window', async () => {
      jest.useFakeTimers();
      try {
        await guard.canActivate(authed());
        dataSource.query.mockResolvedValue([
          { is_active: true, deleted_at: null, session_active: false },
        ]);
        jest.advanceTimersByTime(30_001);
        await expect(guard.canActivate(authed())).rejects.toThrow(
          UnauthorizedException,
        );
      } finally {
        jest.useRealTimers();
      }
    });

    it('shares the cache between guard instances (APP_GUARD and @UseGuards)', async () => {
      await guard.canActivate(authed());
      const other = new JwtAuthGuard(
        jwtService as unknown as JwtService,
        configService as unknown as ConfigService,
        reflector as unknown as Reflector,
        dataSource as unknown as DataSource,
      );
      await other.canActivate(authed());
      expect(dataSource.query).toHaveBeenCalledTimes(1);
    });

    it('caches each session separately (logging one device out keeps the other)', async () => {
      await guard.canActivate(authed());
      jwtService.verifyAsync.mockResolvedValue({
        ...payload,
        sid: '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
      });
      await guard.canActivate(authed());
      expect(dataSource.query).toHaveBeenCalledTimes(2);
    });

    it('refuses a sid that is not a UUID without querying', async () => {
      jwtService.verifyAsync.mockResolvedValue({
        ...payload,
        sid: "x' OR 1=1",
      });
      await expect(guard.canActivate(authed())).rejects.toThrow(
        UnauthorizedException,
      );
      expect(dataSource.query).not.toHaveBeenCalled();
    });

    it('keeps accepting a 7-day token from before B4 (no sid) with the account-only check', async () => {
      jwtService.verifyAsync.mockResolvedValue({
        sub: 'user-1',
        email: 'a@a.com',
        username: 'a',
      });
      dataSource.query.mockResolvedValue([
        { is_active: true, deleted_at: null },
      ]);
      await expect(guard.canActivate(authed())).resolves.toBe(true);
      expect(dataSource.query).toHaveBeenCalledWith(
        'SELECT is_active, deleted_at FROM havit.users WHERE id = $1',
        ['user-1'],
      );
    });
  });
});
