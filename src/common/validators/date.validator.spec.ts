import { validateSync } from 'class-validator';
import { IsFutureDate } from './date.validator';

class DeadlineDto {
  @IsFutureDate()
  deadline: unknown;
}

function errorsFor(value: unknown) {
  const dto = new DeadlineDto();
  dto.deadline = value;
  return validateSync(dto);
}

const DAY_MS = 24 * 60 * 60 * 1000;

describe('IsFutureDate', () => {
  describe('accepts', () => {
    it('an ISO-8601 string in the future', () => {
      const future = new Date(Date.now() + DAY_MS).toISOString();
      expect(errorsFor(future)).toHaveLength(0);
    });

    it('an ISO-8601 date-only string in the future', () => {
      expect(errorsFor('2999-01-01')).toHaveLength(0);
    });

    it('a Date instance in the future', () => {
      expect(errorsFor(new Date(Date.now() + DAY_MS))).toHaveLength(0);
    });
  });

  describe('rejects', () => {
    it('an ISO-8601 string in the past', () => {
      const past = new Date(Date.now() - DAY_MS).toISOString();
      expect(errorsFor(past)).toHaveLength(1);
    });

    it('a Date instance in the past', () => {
      expect(errorsFor(new Date(Date.now() - DAY_MS))).toHaveLength(1);
    });

    it('the current instant (must be strictly in the future)', () => {
      jest.useFakeTimers({ now: new Date('2030-01-01T00:00:00.000Z') });
      try {
        expect(errorsFor('2030-01-01T00:00:00.000Z')).toHaveLength(1);
      } finally {
        jest.useRealTimers();
      }
    });

    it('an empty or whitespace-only string', () => {
      expect(errorsFor('')).toHaveLength(1);
      expect(errorsFor('   ')).toHaveLength(1);
    });

    it('a malformed string', () => {
      expect(errorsFor('not-a-date')).toHaveLength(1);
      expect(errorsFor('2999-13-45')).toHaveLength(1);
    });

    it('an invalid Date instance', () => {
      expect(errorsFor(new Date('nope'))).toHaveLength(1);
    });

    it('a numeric timestamp, even one in the future', () => {
      expect(errorsFor(Date.now() + DAY_MS)).toHaveLength(1);
    });

    it('null, undefined, booleans and objects', () => {
      expect(errorsFor(null)).toHaveLength(1);
      expect(errorsFor(undefined)).toHaveLength(1);
      expect(errorsFor(true)).toHaveLength(1);
      expect(errorsFor({})).toHaveLength(1);
    });
  });

  describe('error message', () => {
    it('names the property and reports the isFutureDate constraint', () => {
      const [error] = errorsFor('2000-01-01T00:00:00.000Z');
      expect(error.property).toBe('deadline');
      expect(error.constraints).toEqual({
        isFutureDate: 'deadline must be a date strictly in the future',
      });
    });

    it('honours a custom message from ValidationOptions', () => {
      class CustomMessageDto {
        @IsFutureDate({ message: 'pick a later date' })
        dueAt: unknown;
      }
      const dto = new CustomMessageDto();
      dto.dueAt = '2000-01-01';
      const [error] = validateSync(dto);
      expect(error.constraints).toEqual({ isFutureDate: 'pick a later date' });
    });
  });
});
