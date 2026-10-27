import {
  ArgumentsHost,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { HttpExceptionFilter } from './http-exception.filter';

describe('HttpExceptionFilter', () => {
  let filter: HttpExceptionFilter;
  let jsonMock: jest.Mock;
  let statusMock: jest.Mock;

  const buildHost = (request: Record<string, unknown> = {}): ArgumentsHost => {
    jsonMock = jest.fn();
    statusMock = jest.fn().mockReturnValue({ json: jsonMock });

    return {
      switchToHttp: () => ({
        getResponse: () => ({ status: statusMock }),
        getRequest: () => ({
          method: 'GET',
          originalUrl: '/test-path',
          ...request,
        }),
      }),
    } as unknown as ArgumentsHost;
  };

  beforeEach(() => {
    filter = new HttpExceptionFilter();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should produce the standard error shape for an HttpException', () => {
    const host = buildHost();
    filter.catch(new NotFoundException('Challenge not found'), host);

    expect(statusMock).toHaveBeenCalledWith(404);
    expect(jsonMock).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 404,
        message: 'Challenge not found',
        code: 'NOT_FOUND',
        path: '/test-path',
      }),
    );
    const body = jsonMock.mock.calls[0][0];
    expect(typeof body.timestamp).toBe('string');
    expect(() => new Date(body.timestamp).toISOString()).not.toThrow();
  });

  it('keeps suspendedUntil on an ACCOUNT_SUSPENDED error and drops it elsewhere', () => {
    const until = '2026-11-01T10:00:00.000Z';
    filter.catch(
      new ForbiddenException({
        message: 'suspended',
        code: 'ACCOUNT_SUSPENDED',
        suspendedUntil: until,
      }),
      buildHost(),
    );
    expect(jsonMock.mock.calls[0][0]).toMatchObject({
      code: 'ACCOUNT_SUSPENDED',
      suspendedUntil: until,
    });

    filter.catch(
      new ForbiddenException({
        message: 'x',
        code: 'OTHER',
        suspendedUntil: until,
      }),
      buildHost(),
    );
    expect(jsonMock.mock.calls[0][0]).not.toHaveProperty('suspendedUntil');
  });

  it('should preserve the message and status of a ForbiddenException', () => {
    const host = buildHost();
    filter.catch(
      new ForbiddenException('You do not have access to this resource'),
      host,
    );

    expect(statusMock).toHaveBeenCalledWith(403);
    expect(jsonMock).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 403,
        message: 'You do not have access to this resource',
        code: 'FORBIDDEN',
      }),
    );
  });

  it('should preserve validation-pipe array messages on a BadRequestException', () => {
    const host = buildHost();
    filter.catch(
      new BadRequestException(['field is required', 'field must be a string']),
      host,
    );

    expect(jsonMock).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 400,
        message: ['field is required', 'field must be a string'],
        code: 'VALIDATION_ERROR',
      }),
    );
  });

  it('should turn an unhandled plain Error into a well-formed 500 without leaking the stack trace to the client', () => {
    const host = buildHost();
    filter.catch(new Error('some internal database error'), host);

    expect(statusMock).toHaveBeenCalledWith(500);
    expect(jsonMock).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 500,
        message: 'Internal server error',
        code: 'INTERNAL',
      }),
    );
    const body = jsonMock.mock.calls[0][0];
    expect(JSON.stringify(body)).not.toContain('some internal database error');
  });

  // body-parser throws http-errors (not Nest exceptions): an oversized body is the caller's
  // fault (413), and must not be logged as an ERROR with a stack.
  it('keeps the 4xx of an Express middleware error (payload too large) and logs a warning, not an error', () => {
    const error = Object.assign(new Error('request entity too large'), {
      status: 413,
      statusCode: 413,
      type: 'entity.too.large',
    });
    const errorLog = jest
      .spyOn(filter['logger'], 'error')
      .mockImplementation(() => undefined);
    const warnLog = jest
      .spyOn(filter['logger'], 'warn')
      .mockImplementation(() => undefined);
    const host = buildHost({ method: 'POST', originalUrl: '/auth/login' });

    filter.catch(error, host);

    expect(statusMock).toHaveBeenCalledWith(413);
    expect(jsonMock).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 413, error: 'Payload Too Large' }),
    );
    expect(errorLog).not.toHaveBeenCalled();
    expect(warnLog).toHaveBeenCalledTimes(1);
  });

  it('does not trust a 5xx status on a plain error: it stays a generic 500', () => {
    const host = buildHost();
    filter.catch(Object.assign(new Error('boom'), { status: 502 }), host);
    expect(statusMock).toHaveBeenCalledWith(500);
  });

  it('should use request.url as a fallback when originalUrl is not present', () => {
    const host = buildHost({ originalUrl: undefined, url: '/fallback-path' });
    filter.catch(new NotFoundException('x'), host);

    expect(jsonMock).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/fallback-path' }),
    );
  });
});
