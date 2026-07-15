import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { STATUS_CODES } from 'http';
import type { Request, Response } from 'express';
import { DEFAULT_ERROR_CODE_BY_STATUS } from '../constants/error-code.enum';

interface StandardErrorBody {
  statusCode: number;
  error: string;
  message: string | string[];
  code?: string;
  timestamp: string;
  path: string;
}

/**
 * Global exception filter — builds the standard error shape documented in
 * `docs/ai/backend/ERROR-HANDLING.md`:
 *   { statusCode, error, message, code?, timestamp, path }
 *
 * `statusCode`/`error`/`message` mirror Nest's existing default shape (a
 * low-friction change, not a breaking rewrite); `code`, `timestamp` and
 * `path` are new. `message` is always present and the HTTP status always
 * reflects the thrown exception — the frontend's Axios interceptor reads
 * both today and must keep working unchanged.
 *
 * Catches everything (`@Catch()`, no filter argument) so a stray
 * `new Error(...)` or other unhandled exception still produces this shape
 * (as a 500) instead of Express's default HTML error page.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionsHandler');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const isHttpException = exception instanceof HttpException;
    const statusCode = isHttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;

    let message: string | string[] = STATUS_CODES[statusCode] ?? 'Error';
    let error: string = STATUS_CODES[statusCode] ?? 'Error';
    let code: string | undefined = DEFAULT_ERROR_CODE_BY_STATUS[statusCode];

    if (isHttpException) {
      const body = exception.getResponse();

      if (typeof body === 'string') {
        message = body;
      } else if (body && typeof body === 'object') {
        const record = body as Record<string, unknown>;
        if (typeof record.message === 'string' || Array.isArray(record.message)) {
          message = record.message as string | string[];
        } else {
          message = exception.message;
        }
        if (typeof record.error === 'string') {
          error = record.error;
        }
        if (typeof record.code === 'string') {
          code = record.code;
        }
      } else {
        message = exception.message;
      }
    } else {
      // Unhandled/unexpected error (e.g. a plain `new Error(...)`, a DB
      // driver error, etc). Log the full detail server-side; the client
      // still gets a well-formed 500 with a generic message, never a raw
      // stack trace.
      message = 'Internal server error';
      const stack = exception instanceof Error ? exception.stack : undefined;
      this.logger.error(
        `Unhandled exception on ${request.method} ${request.originalUrl ?? request.url}: ${
          exception instanceof Error ? exception.message : String(exception)
        }`,
        stack,
      );
    }

    const errorBody: StandardErrorBody = {
      statusCode,
      error,
      message,
      ...(code ? { code } : {}),
      timestamp: new Date().toISOString(),
      path: request.originalUrl ?? request.url,
    };

    response.status(statusCode).json(errorBody);
  }
}
