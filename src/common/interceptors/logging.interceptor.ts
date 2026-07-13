import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Observable, tap } from 'rxjs';

/**
 * The Nest equivalent of Spring AOP @Around advice: wraps every handler,
 * so latency/status logging lives in exactly one place.
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const started = Date.now();

    return next.handle().pipe(
      tap(() => {
        const res = http.getResponse<Response>();
        const ms = Date.now() - started;
        this.logger.log(`${req.method} ${req.url} ${res.statusCode} ${ms}ms`);
      }),
    );
  }
}
