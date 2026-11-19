import 'reflect-metadata';
import { plainToInstance, Type } from 'class-transformer';
import { IsISO8601, IsOptional, validateSync } from 'class-validator';
import { IsFutureDate } from './date.validator';

const NOW = new Date('2026-01-01T00:00:00.000Z');
const FUTURE_ISO = '2026-06-01T12:00:00.000Z';
const PAST_ISO = '2025-06-01T12:00:00.000Z';

class FutureDateDto {
  @IsFutureDate()
  deadline!: unknown;
}

class CustomMessageDto {
  @IsFutureDate({ message: 'pick a later date' })
  deadline!: unknown;
}

/** Mirrors the deadline field on CreateBountyDto / CreateMilestoneDto. */
class OptionalIsoDeadlineDto {
  @IsOptional()
  @IsISO8601()
  @IsFutureDate()
  deadline?: string;
}

/** A deadline transformed to a Date, as on FundEscrowDto (#743). */
class TransformedDeadlineDto {
  @Type(() => Date)
  @IsFutureDate()
  deadline!: Date;
}

function errorsFor<T extends object>(
  cls: new () => T,
  plain: Record<string, unknown>,
) {
  return validateSync(plainToInstance(cls, plain));
}

describe('IsFutureDate', () => {
  beforeAll(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  describe('accepts', () => {
    it.each([
      ['a full ISO-8601 timestamp', FUTURE_ISO],
      ['an ISO-8601 timestamp with offset', '2026-06-01T12:00:00+02:00'],
      ['a date-only ISO-8601 string', '2026-06-01'],
    ])('%s in the future', (_label, deadline) => {
      expect(errorsFor(FutureDateDto, { deadline })).toHaveLength(0);
    });

    it('a Date instance in the future', () => {
      expect(
        errorsFor(FutureDateDto, { deadline: new Date(FUTURE_ISO) }),
      ).toHaveLength(0);
    });

    it('a deadline transformed with @Type(() => Date)', () => {
      expect(
        errorsFor(TransformedDeadlineDto, { deadline: FUTURE_ISO }),
      ).toHaveLength(0);
    });

    it('an omitted optional deadline', () => {
      expect(errorsFor(OptionalIsoDeadlineDto, {})).toHaveLength(0);
    });
  });

  describe('rejects', () => {
    it.each([
      ['a past ISO-8601 string', PAST_ISO],
      ['the current instant (strictly in the future)', NOW.toISOString()],
      ['a past Date instance', new Date(PAST_ISO)],
      ['an empty string', ''],
      ['a whitespace-only string', '   '],
      ['a malformed string', 'not-a-date'],
      ['an impossible calendar date', '2026-13-45'],
      ['a numeric timestamp (ms)', new Date(FUTURE_ISO).getTime()],
      ['a numeric-string timestamp', String(new Date(FUTURE_ISO).getTime())],
      ['an invalid Date instance', new Date('nope')],
      ['null', null],
      ['undefined', undefined],
      ['a boolean', true],
      ['an object', { date: FUTURE_ISO }],
    ])('%s', (_label, deadline) => {
      const errors = errorsFor(FutureDateDto, { deadline });
      expect(errors).toHaveLength(1);
      expect(errors[0].constraints).toHaveProperty('isFutureDate');
    });

    it('a past date on a field transformed with @Type(() => Date)', () => {
      const errors = errorsFor(TransformedDeadlineDto, { deadline: PAST_ISO });
      expect(errors[0].constraints).toHaveProperty('isFutureDate');
    });
  });

  describe('message', () => {
    it('names the property in the default message', () => {
      const [error] = errorsFor(FutureDateDto, { deadline: PAST_ISO });
      expect(error.property).toBe('deadline');
      expect(error.constraints?.isFutureDate).toBe(
        'deadline must be a date strictly in the future',
      );
    });

    it('honours a custom message from ValidationOptions', () => {
      const [error] = errorsFor(CustomMessageDto, { deadline: PAST_ISO });
      expect(error.constraints?.isFutureDate).toBe('pick a later date');
    });
  });
});
