import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

/**
 * Global request logging interceptor: one line per request with
 * method/path/status/duration via Nest's `Logger`. Deliberately does NOT
 * log request bodies (auth credentials, workout images, etc. must never
 * hit the logs).
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    const { method } = request;
    const path = request.originalUrl ?? request.url;
    const start = Date.now();

    return next.handle().pipe(
      tap({
        next: () => {
          const duration = Date.now() - start;
          this.logger.log(`${method} ${path} ${response.statusCode} +${duration}ms`);
        },
        error: (err: unknown) => {
          const duration = Date.now() - start;
          const statusCode =
            (err as { status?: number; getStatus?: () => number })?.status ??
            (err as { getStatus?: () => number })?.getStatus?.() ??
            500;
          this.logger.log(`${method} ${path} ${statusCode} +${duration}ms`);
        },
      }),
    );
  }
}
