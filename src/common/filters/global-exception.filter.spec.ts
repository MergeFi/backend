import {
  ArgumentsHost,
  BadRequestException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { GlobalExceptionFilter } from './global-exception.filter';

interface SanitizedBody {
  statusCode: number;
  message: string;
  errorId: string;
}

function createMockHost(overrides: { method?: string; url?: string } = {}) {
  const json = jest.fn<void, [unknown]>();
  const status = jest.fn(() => ({ json }));
  const response = { status };
  const request = {
    method: overrides.method ?? 'GET',
    url: overrides.url ?? '/api/escrow/esc_1',
    originalUrl: overrides.url ?? '/api/escrow/esc_1',
  };

  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => request,
    }),
  } as unknown as ArgumentsHost;

  return { host, status, json };
}

function sanitizedBodyOf(json: jest.Mock<void, [unknown]>): SanitizedBody {
  return json.mock.calls[0][0] as SanitizedBody;
}

describe('GlobalExceptionFilter', () => {
  let filter: GlobalExceptionFilter;
  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance<void, [string, string?]>;

  beforeEach(() => {
    filter = new GlobalExceptionFilter();
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    errorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation() as jest.SpyInstance<void, [string, string?]>;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('safe client errors (HttpException, status < 500)', () => {
    it('passes a BadRequestException response through unmodified', () => {
      const { host, status, json } = createMockHost();
      const exception = new BadRequestException('Amount must be positive');

      filter.catch(exception, host);

      expect(status).toHaveBeenCalledWith(400);
      expect(json).toHaveBeenCalledWith(exception.getResponse());
      // Unaffected: no errorId injected, no message rewritten.
      expect(json.mock.calls[0][0]).toEqual({
        statusCode: 400,
        message: 'Amount must be positive',
        error: 'Bad Request',
      });
    });

    it('passes a NotFoundException response through unmodified', () => {
      const { host, status, json } = createMockHost();
      const exception = new NotFoundException('Escrow esc_1 not found');

      filter.catch(exception, host);

      expect(status).toHaveBeenCalledWith(404);
      expect(json).toHaveBeenCalledWith(exception.getResponse());
    });

    it('logs safe client errors at warn level, not error', () => {
      const { host } = createMockHost();
      filter.catch(new BadRequestException('bad input'), host);

      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy).not.toHaveBeenCalled();
    });
  });

  describe('sanitized errors (raw Error, or HttpException status >= 500)', () => {
    it('does not leak a raw Soroban simulation error message into the response', () => {
      const { host, status, json } = createMockHost();
      const rawError = new Error(
        'Soroban simulation failed: contract trap: HostError: Error(Contract, #1) at soroban-rpc.internal:8000',
      );

      filter.catch(rawError, host);

      expect(status).toHaveBeenCalledWith(500);
      const body = sanitizedBodyOf(json);
      expect(JSON.stringify(body)).not.toContain('soroban-rpc.internal');
      expect(JSON.stringify(body)).not.toContain('HostError');
      expect(body).toMatchObject({
        statusCode: 500,
        message: expect.stringContaining('reference ID') as string,
      });
      expect(typeof body.errorId).toBe('string');
    });

    it('does not leak a raw TypeORM/Postgres error message into the response', () => {
      const { host, json } = createMockHost();
      const dbError = new Error(
        'duplicate key value violates unique constraint "UQ_bounties_issueId" on table "bounties"',
      );

      filter.catch(dbError, host);

      const body = sanitizedBodyOf(json);
      expect(JSON.stringify(body)).not.toContain('UQ_bounties_issueId');
      expect(JSON.stringify(body)).not.toContain('bounties');
    });

    it('logs the full raw error message and stack server-side', () => {
      const { host } = createMockHost();
      const rawError = new Error('Soroban simulation failed: sensitive detail');

      filter.catch(rawError, host);

      expect(errorSpy).toHaveBeenCalledTimes(1);
      const [logMessage, logStack] = errorSpy.mock.calls[0];
      expect(logMessage).toContain('sensitive detail');
      expect(logStack).toBe(rawError.stack);
    });

    it('includes the same errorId in both the response and the log line', () => {
      const { host, json } = createMockHost();
      filter.catch(new Error('boom'), host);

      const body = sanitizedBodyOf(json);
      const [logMessage] = errorSpy.mock.calls[0];
      expect(logMessage).toContain(body.errorId);
    });

    it('generates a distinct errorId per exception', () => {
      const first = createMockHost();
      const second = createMockHost();

      filter.catch(new Error('first'), first.host);
      filter.catch(new Error('second'), second.host);

      const firstId = sanitizedBodyOf(first.json).errorId;
      const secondId = sanitizedBodyOf(second.json).errorId;
      expect(firstId).not.toBe(secondId);
    });

    it('sanitizes a non-Error thrown value (e.g. a thrown string)', () => {
      const { host, status, json } = createMockHost();

      filter.catch('a raw thrown string with internal detail', host);

      expect(status).toHaveBeenCalledWith(500);
      const body = sanitizedBodyOf(json);
      expect(JSON.stringify(body)).not.toContain('internal detail');
    });
  });
});
