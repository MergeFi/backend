import {
  isValidMoneyAmount,
  amountToStroops,
  stroopsToAmount,
  MAX_MONETARY_AMOUNT,
} from './money.validator';

describe('money.validator', () => {
  describe('isValidMoneyAmount', () => {
    it('accepts a plain positive integer-string', () => {
      expect(isValidMoneyAmount('100')).toBe(true);
      expect(isValidMoneyAmount('1')).toBe(true);
    });

    it('accepts up to 7 fractional digits', () => {
      expect(isValidMoneyAmount('1.5')).toBe(true);
      expect(isValidMoneyAmount('0.1234567')).toBe(true);
    });

    it('rejects more than 7 fractional digits (stroop precision)', () => {
      expect(isValidMoneyAmount('0.12345678')).toBe(false);
    });

    it('rejects zero and negative', () => {
      expect(isValidMoneyAmount('0')).toBe(false);
      expect(isValidMoneyAmount('-5')).toBe(false);
      expect(isValidMoneyAmount('0.0')).toBe(false);
    });

    it('rejects non-string and malformed input', () => {
      expect(isValidMoneyAmount(100)).toBe(false);
      expect(isValidMoneyAmount('abc')).toBe(false);
      expect(isValidMoneyAmount('')).toBe(false);
      expect(isValidMoneyAmount('1.')).toBe(false);
      expect(isValidMoneyAmount('.5')).toBe(false);
      expect(isValidMoneyAmount('01')).toBe(false); // leading zero
    });

    it('rejects an amount above the max', () => {
      expect(isValidMoneyAmount(`${Number(MAX_MONETARY_AMOUNT) + 1}`)).toBe(
        false,
      );
    });
  });

  describe('amountToStroops', () => {
    it('converts a whole amount to stroops', () => {
      expect(amountToStroops('1')).toBe(10_000_000n);
      expect(amountToStroops('100')).toBe(1_000_000_000n);
    });

    it('converts a fractional amount', () => {
      expect(amountToStroops('1.5')).toBe(15_000_000n);
      expect(amountToStroops('0.0000001')).toBe(1n);
    });

    it('throws on an invalid amount', () => {
      expect(() => amountToStroops('not a number')).toThrow();
      expect(() => amountToStroops('-1')).toThrow();
    });
  });

  describe('stroopsToAmount', () => {
    it('formats a stroop total back to a decimal string', () => {
      expect(stroopsToAmount(10_000_000n)).toBe('1.0000000');
      expect(stroopsToAmount(15_000_000n)).toBe('1.5000000');
    });

    it('round-trips through amountToStroops', () => {
      expect(stroopsToAmount(amountToStroops('42.75'))).toBe('42.7500000');
    });

    it('throws on a negative stroop total', () => {
      expect(() => stroopsToAmount(-1n)).toThrow();
    });
  });
});
