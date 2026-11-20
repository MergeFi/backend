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
 * The one exception is 429. It is the only sub-500 status the app does not
 * author itself: ThrottlerGuard throws it with a bare-string body and, for
 * the named throttlers registered in AppModule, a suffixed
 * `Retry-After-<name>` header. The frontend's rate-limit handling reads
 * plain `Retry-After` and a JSON `message`, so both are normalised here
 * (#842) — see {@link normaliseThrottledResponse}.
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
    const tooManyRequestsStatus: number = HttpStatus.TOO_MANY_REQUESTS;
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
      if (response.headersSent) {
        return;
      }
      if (status === tooManyRequestsStatus) {
        response
          .status(status)
          .json(normaliseThrottledResponse(response, exception.getResponse()));
        return;
      }
      response.status(status).json(exception.getResponse());
      return;
    }

    this.logger.error(
      `[${errorId}] ${context} -> ${status}: ${error.message}`,
      error.stack,
    );

    if (response.headersSent) {
      // A response has already begun (e.g. a @Res() handler redirected before
      // a later error). Writing again would throw ERR_HTTP_HEADERS_SENT from
      // inside the filter, so the error is logged above and nothing more.
      return;
    }

    response.status(status).json({
      statusCode: status,
      message:
        'An unexpected error occurred. Please contact support with this reference ID.',
      errorId,
    });
  }
}

/**
 * Shapes a 429 into the contract mergefi-frontend's `apiRequest` reads
 * (#842): a `Retry-After` header in seconds and a JSON body carrying
 * `message`, matching ClientErrorResponseDto.
 *
 * ThrottlerGuard only sets the unsuffixed `Retry-After` for the throttler
 * named `default`; a `short`/`medium`/`long` hit sets `Retry-After-short`
 * etc. instead. When the plain header is missing it is filled from the
 * longest suffixed one, so the client never retries before every exceeded
 * window has reset.
 */
function normaliseThrottledResponse(
  response: Response,
  body: string | object,
): object {
  if (!response.getHeader('Retry-After')) {
    const waits = response
      .getHeaderNames()
      .filter((name) => name.toLowerCase().startsWith('retry-after-'))
      .map((name) => Number(response.getHeader(name)))
      .filter((seconds) => Number.isFinite(seconds));
    if (waits.length > 0) {
      response.setHeader('Retry-After', String(Math.max(...waits)));
    }
  }

  if (typeof body === 'string') {
    return {
      statusCode: HttpStatus.TOO_MANY_REQUESTS,
      message: body,
      error: 'Too Many Requests',
    };
  }
  return body;
}
