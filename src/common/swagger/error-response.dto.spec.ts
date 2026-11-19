import {
  ArgumentsHost,
  BadRequestException,
  ForbiddenException,
  HttpException,
  InternalServerErrorException,
  NotFoundException,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { IsString } from 'class-validator';
import { GlobalExceptionFilter } from '../filters/global-exception.filter';
import {
  ClientErrorResponseDto,
  InternalErrorResponseDto,
} from './error-response.dto';

// Metadata keys @nestjs/swagger stores decorator output under. Not part
// of the package's public exports, so mirrored here.
const DECORATORS = {
  API_MODEL_PROPERTIES: 'swagger/apiModelProperties',
  API_MODEL_PROPERTIES_ARRAY: 'swagger/apiModelPropertiesArray',
} as const;

/** Field names declared via @ApiProperty, as Swagger will publish them. */
function documentedFields(dto: abstract new () => unknown): string[] {
  const names = Reflect.getMetadata(
    DECORATORS.API_MODEL_PROPERTIES_ARRAY,
    dto.prototype as object,
  ) as string[];
  return names.map((n) => n.replace(/^:/, '')).sort();
}

function propertyMeta(
  dto: abstract new () => unknown,
  field: string,
): Record<string, unknown> {
  return Reflect.getMetadata(
    DECORATORS.API_MODEL_PROPERTIES,
    dto.prototype as object,
    field,
  ) as Record<string, unknown>;
}

/** Runs GlobalExceptionFilter against `exception` and returns status + body. */
function filterOutput(exception: unknown): {
  status: number;
  body: Record<string, unknown>;
} {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const host = {
    switchToHttp: () => ({
      getResponse: () => ({ status }),
      getRequest: () => ({ method: 'POST', url: '/probe' }),
    }),
  } as unknown as ArgumentsHost;
  const filter = new GlobalExceptionFilter();
  (filter as unknown as { logger: object }).logger = {
    warn: jest.fn(),
    error: jest.fn(),
  };

  filter.catch(exception, host);

  return {
    status: status.mock.calls[0][0] as number,
    body: json.mock.calls[0][0] as Record<string, unknown>,
  };
}

/**
 * Asserts `body` is representable by ClientErrorResponseDto: every key is a
 * documented field, and each value has the documented type.
 */
function expectRepresentableAsClientError(body: Record<string, unknown>) {
  expect(documentedFields(ClientErrorResponseDto)).toEqual(
    expect.arrayContaining(Object.keys(body)),
  );
  const required = documentedFields(ClientErrorResponseDto).filter(
    (f) => propertyMeta(ClientErrorResponseDto, f).required !== false,
  );
  expect(Object.keys(body)).toEqual(expect.arrayContaining(required));
  expect(typeof body.statusCode).toBe('number');
  if ('error' in body) {
    expect(typeof body.error).toBe('string');
  }
  const message = body.message;
  expect(
    typeof message === 'string' ||
      (Array.isArray(message) && message.every((m) => typeof m === 'string')),
  ).toBe(true);
}

class ProbeBody {
  @IsString()
  name!: string;
}

describe('error-response DTOs', () => {
  describe('InternalErrorResponseDto', () => {
    it.each([
      ['a raw Error', new Error('db exploded')],
      ['a non-Error throwable', 'string thrown'],
      ['a 5xx HttpException', new InternalServerErrorException('internal')],
    ])(
      'documents exactly the fields GlobalExceptionFilter emits for %s',
      (_label, exception) => {
        const { status, body } = filterOutput(exception);

        expect(status).toBeGreaterThanOrEqual(500);
        expect(documentedFields(InternalErrorResponseDto)).toEqual(
          Object.keys(body).sort(),
        );
      },
    );

    it('types each documented field as the filter emits it', () => {
      const { body } = filterOutput(new Error('boom'));

      expect(typeof body.statusCode).toBe('number');
      expect(typeof body.message).toBe('string');
      expect(typeof body.errorId).toBe('string');
      expect(propertyMeta(InternalErrorResponseDto, 'statusCode').type).toBe(
        Number,
      );
      expect(propertyMeta(InternalErrorResponseDto, 'message').type).toBe(
        String,
      );
      expect(propertyMeta(InternalErrorResponseDto, 'errorId').type).toBe(
        String,
      );
    });

    it("uses the filter's real message as its example", () => {
      const { body } = filterOutput(new Error('boom'));

      expect(propertyMeta(InternalErrorResponseDto, 'message').example).toBe(
        body.message,
      );
    });

    it('does not document a `code` field — the filter never emits one', () => {
      // mergefi-frontend's apiRequest reads `parsed.code`; it is always
      // undefined against this backend, and the DTO must not suggest otherwise.
      expect(documentedFields(InternalErrorResponseDto)).not.toContain('code');
      expect(documentedFields(ClientErrorResponseDto)).not.toContain('code');
    });
  });

  describe('ClientErrorResponseDto', () => {
    it.each([
      ['BadRequestException', new BadRequestException('Invalid amount')],
      ['UnauthorizedException', new UnauthorizedException()],
      ['ForbiddenException', new ForbiddenException('Not the sponsor')],
      ['NotFoundException', new NotFoundException('Escrow esc_1 not found')],
    ])(
      'can represent the pass-through body of a %s',
      (_label, exception: HttpException) => {
        const { status, body } = filterOutput(exception);

        expect(status).toBeLessThan(500);
        expect(body).toEqual(exception.getResponse());
        expectRepresentableAsClientError(body);
      },
    );

    it("can represent ValidationPipe's aggregated message array", async () => {
      const pipe = new ValidationPipe();
      const exception = await pipe
        .transform({ name: 42 }, { type: 'body', metatype: ProbeBody })
        .then(
          () => {
            throw new Error('expected validation to fail');
          },
          (e: unknown) => e as HttpException,
        );

      const { body } = filterOutput(exception);

      expect(Array.isArray(body.message)).toBe(true);
      expectRepresentableAsClientError(body);
    });

    it('documents `error` as optional, since a message-less exception omits it', () => {
      const { body } = filterOutput(new UnauthorizedException());

      expect(body).toEqual({ statusCode: 401, message: 'Unauthorized' });
      expect(propertyMeta(ClientErrorResponseDto, 'error').required).toBe(
        false,
      );
      // Swagger treats an unset `required` as required.
      expect(
        propertyMeta(ClientErrorResponseDto, 'statusCode').required,
      ).not.toBe(false);
      expect(propertyMeta(ClientErrorResponseDto, 'message').required).not.toBe(
        false,
      );
    });

    it('documents `message` as either a string or a string array', () => {
      expect(propertyMeta(ClientErrorResponseDto, 'message').oneOf).toEqual([
        { type: 'string' },
        { type: 'array', items: { type: 'string' } },
      ]);
    });
  });
});
