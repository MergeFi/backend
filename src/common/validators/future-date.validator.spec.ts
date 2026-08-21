import { isFutureDate, IsFutureDate } from './future-date.validator';
import { validate } from 'class-validator';

class TestDto {
  @IsFutureDate()
  deadline?: string;
}

describe('future-date.validator', () => {
  describe('isFutureDate helper', () => {
    it('returns true for a future date string', () => {
      const future = new Date(Date.now() + 100_000).toISOString();
      expect(isFutureDate(future)).toBe(true);
    });

    it('returns false for a past date string', () => {
      const past = new Date(Date.now() - 100_000).toISOString();
      expect(isFutureDate(past)).toBe(false);
    });

    it('returns false for invalid date strings or non-strings', () => {
      expect(isFutureDate('not-a-date')).toBe(false);
      expect(isFutureDate(12345)).toBe(false);
      expect(isFutureDate({})).toBe(false);
    });
  });

  describe('@IsFutureDate decorator', () => {
    it('passes when deadline is undefined/null (optional)', async () => {
      const dto = new TestDto();
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('passes when deadline is in the future', async () => {
      const dto = new TestDto();
      dto.deadline = new Date(Date.now() + 86_400_000).toISOString();
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('fails when deadline is in the past', async () => {
      const dto = new TestDto();
      dto.deadline = new Date(Date.now() - 86_400_000).toISOString();
      const errors = await validate(dto);
      expect(errors).toHaveLength(1);
      expect(errors[0].constraints?.isFutureDate).toBeDefined();
    });
  });
});
