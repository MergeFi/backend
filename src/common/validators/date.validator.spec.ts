import { validate } from 'class-validator';
import { IsFutureDate } from './date.validator';

class TestModel {
  @IsFutureDate()
  date?: unknown;

  constructor(date?: unknown) {
    this.date = date;
  }
}

class CustomMessageModel {
  @IsFutureDate({ message: 'Custom deadline must be in the future' })
  deadline?: unknown;

  constructor(deadline?: unknown) {
    this.deadline = deadline;
  }
}

describe('IsFutureDate validator', () => {
  describe('future dates', () => {
    it('accepts a date string in the future', async () => {
      const futureDate = new Date(
        Date.now() + 1000 * 60 * 60 * 24,
      ).toISOString();
      const model = new TestModel(futureDate);
      const errors = await validate(model);
      expect(errors.length).toBe(0);
    });

    it('accepts a future date string specified far in the future', async () => {
      const farFutureDate = new Date(
        Date.now() + 1000 * 60 * 60 * 24 * 365,
      ).toISOString();
      const model = new TestModel(farFutureDate);
      const errors = await validate(model);
      expect(errors.length).toBe(0);
    });
  });

  describe('past dates', () => {
    it('rejects a date string in the past', async () => {
      const model = new TestModel('2020-01-01T00:00:00.000Z');
      const errors = await validate(model);
      expect(errors.length).toBeGreaterThan(0);
      const error = errors.find((e) => e.property === 'date');
      expect(error).toBeDefined();
      expect(error?.constraints?.isFutureDate).toBe(
        'date must be a date strictly in the future',
      );
    });

    it('rejects a relative past date', async () => {
      const pastDate = new Date(Date.now() - 1000 * 60).toISOString();
      const model = new TestModel(pastDate);
      const errors = await validate(model);
      expect(errors.length).toBeGreaterThan(0);
      const error = errors.find((e) => e.property === 'date');
      expect(error).toBeDefined();
      expect(error?.constraints?.isFutureDate).toBe(
        'date must be a date strictly in the future',
      );
    });
  });

  describe('current date / now', () => {
    afterEach(() => {
      jest.useRealTimers();
    });

    it('rejects a date equal to the current time', async () => {
      const fixedNow = new Date('2026-06-01T12:00:00.000Z');
      jest.useFakeTimers();
      jest.setSystemTime(fixedNow);

      const model = new TestModel(fixedNow.toISOString());
      const errors = await validate(model);
      expect(errors.length).toBeGreaterThan(0);
      const error = errors.find((e) => e.property === 'date');
      expect(error).toBeDefined();
      expect(error?.constraints?.isFutureDate).toBe(
        'date must be a date strictly in the future',
      );
    });
  });

  describe('invalid date strings', () => {
    it('rejects an empty string', async () => {
      const model = new TestModel('');
      const errors = await validate(model);
      expect(errors.length).toBeGreaterThan(0);
      const error = errors.find((e) => e.property === 'date');
      expect(error).toBeDefined();
      expect(error?.constraints?.isFutureDate).toBe(
        'date must be a date strictly in the future',
      );
    });

    it('rejects a malformed date string', async () => {
      const model = new TestModel('not-a-valid-date');
      const errors = await validate(model);
      expect(errors.length).toBeGreaterThan(0);
      const error = errors.find((e) => e.property === 'date');
      expect(error).toBeDefined();
      expect(error?.constraints?.isFutureDate).toBe(
        'date must be a date strictly in the future',
      );
    });
  });

  describe('non-string values', () => {
    it('rejects undefined', async () => {
      const model = new TestModel(undefined);
      const errors = await validate(model);
      expect(errors.length).toBeGreaterThan(0);
      const error = errors.find((e) => e.property === 'date');
      expect(error).toBeDefined();
      expect(error?.constraints?.isFutureDate).toBe(
        'date must be a date strictly in the future',
      );
    });

    it('rejects null', async () => {
      const model = new TestModel(null);
      const errors = await validate(model);
      expect(errors.length).toBeGreaterThan(0);
      const error = errors.find((e) => e.property === 'date');
      expect(error).toBeDefined();
    });

    it('rejects a number', async () => {
      const model = new TestModel(1700000000000);
      const errors = await validate(model);
      expect(errors.length).toBeGreaterThan(0);
      const error = errors.find((e) => e.property === 'date');
      expect(error).toBeDefined();
    });

    it('rejects a Date object', async () => {
      const futureDateObj = new Date(Date.now() + 1000 * 60 * 60 * 24);
      const model = new TestModel(futureDateObj);
      const errors = await validate(model);
      expect(errors.length).toBeGreaterThan(0);
      const error = errors.find((e) => e.property === 'date');
      expect(error).toBeDefined();
    });

    it('rejects a boolean', async () => {
      const model = new TestModel(true);
      const errors = await validate(model);
      expect(errors.length).toBeGreaterThan(0);
      const error = errors.find((e) => e.property === 'date');
      expect(error).toBeDefined();
    });

    it('rejects an object', async () => {
      const model = new TestModel({ date: '2099-01-01' });
      const errors = await validate(model);
      expect(errors.length).toBeGreaterThan(0);
      const error = errors.find((e) => e.property === 'date');
      expect(error).toBeDefined();
    });
  });

  describe('custom validation options', () => {
    it('uses custom error message if provided', async () => {
      const model = new CustomMessageModel('2020-01-01T00:00:00.000Z');
      const errors = await validate(model);
      expect(errors.length).toBeGreaterThan(0);
      const error = errors.find((e) => e.property === 'deadline');
      expect(error).toBeDefined();
      expect(error?.constraints?.isFutureDate).toBe(
        'Custom deadline must be in the future',
      );
    });
  });
});
