import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtAuthGuard } from './jwt-auth.guard';

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;
  let jwtService: { verifyAsync: jest.Mock };
  let configService: { getOrThrow: jest.Mock };
  let reflector: { getAllAndOverride: jest.Mock };

  const buildContext = (headers: Record<string, string> = {}): ExecutionContext => {
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

    guard = new JwtAuthGuard(
      jwtService as unknown as JwtService,
      configService as unknown as ConfigService,
      reflector as unknown as Reflector,
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

    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
    expect(jwtService.verifyAsync).not.toHaveBeenCalled();
  });

  it('should reject the request when the Authorization header has no token', async () => {
    const context = buildContext({ authorization: 'Bearer' });

    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });

  it('should reject the request when the token is invalid or expired', async () => {
    jwtService.verifyAsync.mockRejectedValue(new Error('jwt expired'));
    const context = buildContext({ authorization: 'Bearer expired.token.here' });

    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });
});
