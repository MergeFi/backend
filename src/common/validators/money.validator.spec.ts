import {
  isValidMoneyAmount,
  amountToStroops,
  stroopsToAmount,
  isSupportedEscrowAsset,
  MAX_MONETARY_AMOUNT,
} from './money.validator';
import { AssetType } from '../enums';

describe('money.validator', () => {
  describe('isValidMoneyAmount', () => {
    it('accepts valid positive amounts within 7 decimals', () => {
      expect(isValidMoneyAmount('1')).toBe(true);
      expect(isValidMoneyAmount('100.5')).toBe(true);
      expect(isValidMoneyAmount('0.0000001')).toBe(true);
      expect(isValidMoneyAmount('99.1234567')).toBe(true);
      expect(isValidMoneyAmount(MAX_MONETARY_AMOUNT)).toBe(true);
    });

    it('rejects 8 decimal places', () => {
      expect(isValidMoneyAmount('0.00000001')).toBe(false);
      expect(isValidMoneyAmount('1.12345678')).toBe(false);
    });

    it('rejects 0 and non-positive numbers', () => {
      expect(isValidMoneyAmount('0')).toBe(false);
      expect(isValidMoneyAmount('0.0')).toBe(false);
      expect(isValidMoneyAmount('0.0000000')).toBe(false);
      expect(isValidMoneyAmount('-1')).toBe(false);
      expect(isValidMoneyAmount('-0.5')).toBe(false);
    });

    it('rejects values exceeding the 100,000,000 cap', () => {
      expect(isValidMoneyAmount('100000000.0000001')).toBe(false);
      expect(isValidMoneyAmount('100000001')).toBe(false);
    });

    it('rejects numbers with illegal leading zeros', () => {
      expect(isValidMoneyAmount('01')).toBe(false);
      expect(isValidMoneyAmount('01.5')).toBe(false);
      expect(isValidMoneyAmount('00.123')).toBe(false);
    });

    it('rejects non-strings and malformed numeric strings', () => {
      expect(isValidMoneyAmount(123)).toBe(false);
      expect(isValidMoneyAmount(null)).toBe(false);
      expect(isValidMoneyAmount(undefined)).toBe(false);
      expect(isValidMoneyAmount('')).toBe(false);
      expect(isValidMoneyAmount('abc')).toBe(false);
      expect(isValidMoneyAmount('1.2.3')).toBe(false);
    });
  });

  describe('amountToStroops and stroopsToAmount', () => {
    it('accurately converts amount to stroops and back', () => {
      const amount = '123.4567000';
      const stroops = amountToStroops(amount);
      expect(stroops).toBe(1234567000n);

      const roundTrip = stroopsToAmount(stroops);
      expect(roundTrip).toBe('123.4567000');
    });

    it('handles minimum positive amount round-trip', () => {
      const minAmount = '0.0000001';
      const stroops = amountToStroops(minAmount);
      expect(stroops).toBe(1n);
      expect(stroopsToAmount(stroops)).toBe('0.0000001');
    });

    it('handles maximum amount round-trip', () => {
      const stroops = amountToStroops(MAX_MONETARY_AMOUNT);
      expect(stroopsToAmount(stroops)).toBe(`${MAX_MONETARY_AMOUNT}.0000000`);
    });

    it('amountToStroops throws on invalid money amount', () => {
      expect(() => amountToStroops('0')).toThrow();
      expect(() => amountToStroops('1.12345678')).toThrow();
      expect(() => amountToStroops('invalid')).toThrow();
    });

    it('stroopsToAmount throws on negative stroops', () => {
      expect(() => stroopsToAmount(-1n)).toThrow(
        'Stroops amount must be non-negative',
      );
    });
  });

  describe('isSupportedEscrowAsset', () => {
    it('accepts USDC and XLM', () => {
      expect(isSupportedEscrowAsset(AssetType.USDC)).toBe(true);
      expect(isSupportedEscrowAsset(AssetType.XLM)).toBe(true);
    });

    it('rejects unsupported assets', () => {
      expect(isSupportedEscrowAsset('BTC')).toBe(false);
      expect(isSupportedEscrowAsset('ETH')).toBe(false);
      expect(isSupportedEscrowAsset(null)).toBe(false);
    });
  });
});
