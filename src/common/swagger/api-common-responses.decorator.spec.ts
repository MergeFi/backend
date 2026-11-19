import {
  ArgumentsHost,
  Controller,
  Get,
  INestApplication,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import { GlobalExceptionFilter } from '../filters/global-exception.filter';
import {
  ApiBadRequestResponse,
  ApiForbiddenResponse,
  ApiInternalErrorResponse,
  ApiNotFoundResponse,
  ApiStandardErrorResponses,
  ApiUnauthorizedResponse,
} from './api-common-responses.decorator';
import {
  ClientErrorResponseDto,
  InternalErrorResponseDto,
} from './error-response.dto';

// Metadata keys @nestjs/swagger stores decorator output under. Not part
// of the package's public exports, so mirrored here.
const DECORATORS = {
  API_RESPONSE: 'swagger/apiResponse',
} as const;

type ResponseMetadata = Record<string, { description: string; type: unknown }>;

function responsesOf(
  target: object,
  method: string,
): ResponseMetadata | undefined {
  const descriptor = Object.getOwnPropertyDescriptor(target, method);
  return Reflect.getMetadata(
    DECORATORS.API_RESPONSE,
    descriptor!.value as object,
  ) as ResponseMetadata | undefined;
}

/**
 * Throwaway controller applying each decorator the same way the real
 * controllers do (#823): ApiInternalErrorResponse once at class level, the
 * rest per method.
 */
@ApiInternalErrorResponse()
@Controller('swagger-probe')
class ProbeController {
  @Get('bad-request')
  @ApiBadRequestResponse()
  badRequest(): void {}

  @Get('unauthorized')
  @ApiUnauthorizedResponse()
  unauthorized(): void {}

  @Get('forbidden')
  @ApiForbiddenResponse()
  forbidden(): void {}

  @Get('not-found')
  @ApiNotFoundResponse()
  notFound(): void {}

  @Get('standard')
  @ApiStandardErrorResponses()
  standard(): void {}

  @Get('undecorated')
  undecorated(): void {}
}

describe('api-common-responses decorators', () => {
  describe('metadata', () => {
    const proto = ProbeController.prototype;

    it.each([
      ['badRequest', '400', 'Request validation failed.'],
      ['unauthorized', '401', 'Missing or invalid bearer token.'],
      [
        'forbidden',
        '403',
        'Authenticated, but not permitted to perform this action.',
      ],
      ['notFound', '404', 'The requested resource does not exist.'],
    ])(
      '%s attaches exactly a %s ClientErrorResponseDto response',
      (method, status, description) => {
        expect(responsesOf(proto, method)).toEqual({
          [status]: {
            description,
            type: ClientErrorResponseDto,
            isArray: false,
          },
        });
      },
    );

    it('ApiStandardErrorResponses composes 400, 401 and 404 but not 500', () => {
      const responses = responsesOf(proto, 'standard');

      expect(Object.keys(responses ?? {}).sort()).toEqual([
        '400',
        '401',
        '404',
      ]);
      for (const status of ['400', '401', '404']) {
        expect(responses![status].type).toBe(ClientErrorResponseDto);
      }
    });

    it('ApiInternalErrorResponse attaches a 500 InternalErrorResponseDto at class level', () => {
      expect(
        Reflect.getMetadata(DECORATORS.API_RESPONSE, ProbeController),
      ).toEqual({
        '500': {
          description: 'Unexpected server error. See GlobalExceptionFilter.',
          type: InternalErrorResponseDto,
          isArray: false,
        },
      });
    });

    it('leaves an undecorated method without method-level responses', () => {
      expect(responsesOf(proto, 'undecorated')).toBeUndefined();
    });
  });

  describe('generated OpenAPI document', () => {
    let app: INestApplication;
    let document: OpenAPIObject;

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        controllers: [ProbeController],
      }).compile();
      app = moduleRef.createNestApplication();
      app.useLogger(false);
      await app.init();
      document = SwaggerModule.createDocument(app, {
        openapi: '3.0.0',
        info: { title: 'probe', version: '1' },
      });
    });

    afterAll(async () => {
      await app.close();
    });

    const responseCodes = (path: string): string[] =>
      Object.keys(document.paths[path].get!.responses).sort();

    it.each([
      ['/swagger-probe/bad-request', ['400', '500']],
      ['/swagger-probe/unauthorized', ['401', '500']],
      ['/swagger-probe/forbidden', ['403', '500']],
      ['/swagger-probe/not-found', ['404', '500']],
      ['/swagger-probe/standard', ['400', '401', '404', '500']],
    ])('documents the error responses of %s', (path, statuses) => {
      expect(responseCodes(path)).toEqual(expect.arrayContaining(statuses));
    });

    it('applies the class-level 500 to every route, including undecorated ones', () => {
      expect(responseCodes('/swagger-probe/undecorated')).toContain('500');
    });

    it('references the error DTOs as schemas', () => {
      const responses = document.paths['/swagger-probe/standard'].get!
        .responses as Record<
        string,
        { content: { 'application/json': { schema: { $ref: string } } } }
      >;

      expect(responses['500'].content['application/json'].schema.$ref).toBe(
        '#/components/schemas/InternalErrorResponseDto',
      );
      expect(responses['404'].content['application/json'].schema.$ref).toBe(
        '#/components/schemas/ClientErrorResponseDto',
      );
    });

    it("documents a 500 schema whose keys match GlobalExceptionFilter's actual 5xx body", () => {
      const json = jest.fn();
      const response = { status: jest.fn().mockReturnValue({ json }) };
      const host = {
        switchToHttp: () => ({
          getResponse: () => response,
          getRequest: () => ({ method: 'GET', url: '/x' }),
        }),
      } as unknown as ArgumentsHost;
      const filter = new GlobalExceptionFilter();
      (filter as unknown as { logger: { error: jest.Mock } }).logger = {
        error: jest.fn(),
      };

      filter.catch(new Error('boom'), host);

      const emitted = json.mock.calls[0][0] as Record<string, unknown>;
      const schema = document.components!.schemas!.InternalErrorResponseDto as {
        properties: Record<string, unknown>;
      };

      expect(Object.keys(schema.properties).sort()).toEqual(
        Object.keys(emitted).sort(),
      );
    });
  });
});
