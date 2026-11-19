import { ApiProperty } from '@nestjs/swagger';

/**
 * Response shape for a 500+ error, exactly as `GlobalExceptionFilter`
 * builds it (#360). Internal detail is deliberately never included — only
 * a generic message and a correlation `errorId` to quote when reporting.
 */
export class InternalErrorResponseDto {
  @ApiProperty({ example: 500 })
  statusCode: number;

  @ApiProperty({
    example:
      'An unexpected error occurred. Please contact support with this reference ID.',
  })
  message: string;

  @ApiProperty({
    description: 'Correlation id logged server-side alongside the full error.',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  })
  errorId: string;
}

/**
 * Response shape for a client HttpException (4xx) below 500 — passed
 * through unmodified by `GlobalExceptionFilter` (#360). Matches Nest's
 * default `HttpException.getResponse()` body. `message` is a single
 * string for most thrown exceptions (`BadRequestException('...')`) and an
 * array of strings for class-validator's aggregated DTO validation
 * failures.
 */
export class ClientErrorResponseDto {
  @ApiProperty({ example: 400 })
  statusCode: number;

  @ApiProperty({
    oneOf: [
      { type: 'string' },
      { type: 'array', items: { type: 'string' } },
    ],
    example: 'Escrow esc_1 not found',
  })
  message: string | string[];

  @ApiProperty({ example: 'Bad Request' })
  error: string;
}
