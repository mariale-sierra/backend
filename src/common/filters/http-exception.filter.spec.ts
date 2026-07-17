import { ArgumentsHost, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
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
        getRequest: () => ({ method: 'GET', originalUrl: '/test-path', ...request }),
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

  it('should preserve the message and status of a ForbiddenException', () => {
    const host = buildHost();
    filter.catch(new ForbiddenException('You do not have access to this resource'), host);

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
    filter.catch(new BadRequestException(['field is required', 'field must be a string']), host);

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

  it('should use request.url as a fallback when originalUrl is not present', () => {
    const host = buildHost({ originalUrl: undefined, url: '/fallback-path' });
    filter.catch(new NotFoundException('x'), host);

    expect(jsonMock).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/fallback-path' }),
    );
  });
});
