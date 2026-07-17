import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { randomUUID } from 'crypto';

/**
 * Catches every unhandled exception reaching the HTTP layer and draws a
 * single, principled line between what's safe to show a client and what
 * isn't: the HTTP status code.
 *
 *  - HttpExceptions with a status below 500 (BadRequestException,
 *    NotFoundException, UnauthorizedException, ConflictException, etc.)
 *    are *intentional, validated, client-facing* messages — authored by
 *    application code specifically to be read by whoever's calling the
 *    API. These pass through completely unmodified, response body and
 *    all, so nothing about existing validation-error behavior changes.
 *  - Everything else — a raw `Error` (e.g. a Soroban simulation failure
 *    or a TypeORM/Postgres error, neither of which are HttpExceptions),
 *    or any HttpException whose status is 500+ — is internal-only detail
 *    that must never reach a client. These get a generic message and a
 *    correlation `errorId` the caller can quote when reporting the issue,
 *    while the full original error (message + stack) is always logged
 *    server-side at `error` level.
 *
 * Registered globally in main.ts via `app.useGlobalFilters(...)` (#19).
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const internalServerErrorStatus: number = HttpStatus.INTERNAL_SERVER_ERROR;
    const isHttpException = exception instanceof HttpException;
    const status: number = isHttpException
      ? exception.getStatus()
      : internalServerErrorStatus;
    const isSafeClientError =
      isHttpException && status < internalServerErrorStatus;

    const error =
      exception instanceof Error ? exception : new Error(String(exception));
    const errorId = randomUUID();
    const context = `${request.method} ${request.originalUrl ?? request.url}`;

    if (isSafeClientError) {
      // Still worth a log line (helps correlate client-reported issues to
      // requests), but at warn — this is expected application behavior,
      // not a bug — and the response body is untouched.
      this.logger.warn(
        `[${errorId}] ${context} -> ${status}: ${error.message}`,
      );
      response.status(status).json(exception.getResponse());
      return;
    }

    this.logger.error(
      `[${errorId}] ${context} -> ${status}: ${error.message}`,
      error.stack,
    );

    response.status(status).json({
      statusCode: status,
      message:
        'An unexpected error occurred. Please contact support with this reference ID.',
      errorId,
    });
  }
}
