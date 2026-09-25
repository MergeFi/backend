import { applyDecorators } from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';
import {
  ClientErrorResponseDto,
  InternalErrorResponseDto,
} from './error-response.dto';

/**
 * Documents the error shapes every endpoint can actually return (#360).
 * Zero `@ApiResponse` decorators existed anywhere before this, despite
 * `GlobalExceptionFilter` (src/common/filters/global-exception.filter.ts)
 * producing a precise, stable shape for every non-2xx response — this is
 * the single place that shape is described for Swagger, applied once per
 * controller rather than reimplemented per endpoint.
 *
 * `ApiInternalErrorResponse()` is safe to apply everywhere: every route is
 * reachable by `GlobalExceptionFilter`'s 500 branch regardless of what the
 * endpoint itself does.
 *
 * The others are opt-in per controller/method since they only apply where
 * relevant (e.g. no `@ApiUnauthorizedResponse()` on a public, unguarded
 * endpoint).
 */
export function ApiInternalErrorResponse() {
  return applyDecorators(
    ApiResponse({
      status: 500,
      description: 'Unexpected server error. See GlobalExceptionFilter.',
      type: InternalErrorResponseDto,
    }),
  );
}

export function ApiBadRequestResponse() {
  return applyDecorators(
    ApiResponse({
      status: 400,
      description: 'Request validation failed.',
      type: ClientErrorResponseDto,
    }),
  );
}

export function ApiUnauthorizedResponse() {
  return applyDecorators(
    ApiResponse({
      status: 401,
      description: 'Missing or invalid bearer token.',
      type: ClientErrorResponseDto,
    }),
  );
}

export function ApiForbiddenResponse() {
  return applyDecorators(
    ApiResponse({
      status: 403,
      description: 'Authenticated, but not permitted to perform this action.',
      type: ClientErrorResponseDto,
    }),
  );
}

export function ApiNotFoundResponse() {
  return applyDecorators(
    ApiResponse({
      status: 404,
      description: 'The requested resource does not exist.',
      type: ClientErrorResponseDto,
    }),
  );
}

/**
 * Bundle for a standard authenticated, ID-addressed mutation/lookup
 * endpoint: 400 (validation), 401 (no/invalid token), 404 (not found).
 * 500 is intentionally excluded — apply `@ApiInternalErrorResponse()` once
 * at the controller class instead, since it applies to every route
 * regardless of method. Covers the common case across the
 * escrow/bounties/milestones/teams/maintenance-pool controllers without
 * repeating all three at every method.
 */
export function ApiStandardErrorResponses() {
  return applyDecorators(
    ApiBadRequestResponse(),
    ApiUnauthorizedResponse(),
    ApiNotFoundResponse(),
  );
}
