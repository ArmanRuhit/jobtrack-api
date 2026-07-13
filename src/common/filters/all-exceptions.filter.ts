import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { PrismaClientKnownRequestError } from '../../generated/prisma/internal/prismaNamespace';

interface ErrorBody {
  statusCode: number;
  message: string | string[];
  error: string;
  path: string;
  timestamp: string;
  requestId?: string;
}

/**
 * One place that turns any thrown thing into a consistent JSON error envelope.
 * Prisma's error codes are mapped here so persistence details never leak as 500s.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    const { status, message, error } = this.normalize(exception);

    const body: ErrorBody = {
      statusCode: status,
      message,
      error,
      path: req.url,
      timestamp: new Date().toISOString(),
      requestId: req.headers['x-request-id'] as string | undefined,
    };

    if (status >= Number(HttpStatus.INTERNAL_SERVER_ERROR)) {
      this.logger.error(
        `${req.method} ${req.url} -> ${status}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    res.status(status).json(body);
  }

  private normalize(exception: unknown): {
    status: number;
    message: string | string[];
    error: string;
  } {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();
      if (typeof payload === 'string') {
        return { status, message: payload, error: exception.name };
      }
      const obj = payload as { message?: string | string[]; error?: string };
      return {
        status,
        message: obj.message ?? exception.message,
        error: obj.error ?? exception.name,
      };
    }

    if (exception instanceof PrismaClientKnownRequestError) {
      switch (exception.code) {
        case 'P2002':
          return {
            status: HttpStatus.CONFLICT,
            message: `Unique constraint violated on ${String(
              (exception.meta as { target?: string[] } | undefined)?.target ??
                'field',
            )}`,
            error: 'Conflict',
          };
        case 'P2025':
          return {
            status: HttpStatus.NOT_FOUND,
            message: 'Record not found',
            error: 'Not Found',
          };
        case 'P2003':
          return {
            status: HttpStatus.BAD_REQUEST,
            message: 'Related record does not exist',
            error: 'Bad Request',
          };
      }
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Internal server error',
      error: 'Internal Server Error',
    };
  }
}
