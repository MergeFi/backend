import { validate } from 'class-validator';
import { AssetType } from '../enums';
import {
  amountToStroops,
  isSupportedEscrowAsset,
  isValidMoneyAmount,
  stroopsToAmount,
  IsMoneyAmount,
  IsSupportedEscrowAsset,
  MAX_MONETARY_AMOUNT,
  SUPPORTED_ESCROW_ASSETS,
} from './money.validator';

class TestBountyFundingDto {
  @IsMoneyAmount()
  amount: unknown;

  @IsSupportedEscrowAsset()
  asset: unknown;

  constructor(amount: unknown, asset: unknown) {
    this.amount = amount;
    this.asset = asset;
  }
}

class TestCustomMoneyDto {
  @IsMoneyAmount({ message: 'Custom invalid amount' })
  amount: unknown;

  @IsSupportedEscrowAsset({ message: 'Custom unsupported asset' })
  asset: unknown;

  constructor(amount: unknown, asset: unknown) {
    this.amount = amount;
    this.asset = asset;
  }
}

describe('isValidMoneyAmount', () => {
  it('accepts integer amounts up to the cap', () => {
    expect(isValidMoneyAmount('1')).toBe(true);
    expect(isValidMoneyAmount('1000')).toBe(true);
    expect(isValidMoneyAmount('100000000')).toBe(true);
  });

  it('accepts 7-decimal-place boundary precision', () => {
    expect(isValidMoneyAmount('0.0000001')).toBe(true);
    expect(isValidMoneyAmount('100.1234567')).toBe(true);
    expect(isValidMoneyAmount('100000000.0000000')).toBe(true);
  });

  it('rejects 8 or more decimal places', () => {
    expect(isValidMoneyAmount('0.00000001')).toBe(false);
    expect(isValidMoneyAmount('1.12345678')).toBe(false);
    expect(isValidMoneyAmount('100.123456789')).toBe(false);
  });

  it('rejects zero amounts', () => {
    expect(isValidMoneyAmount('0')).toBe(false);
    expect(isValidMoneyAmount('0.0')).toBe(false);
    expect(isValidMoneyAmount('0.0000000')).toBe(false);
  });

  it('rejects amounts exceeding the 100,000,000 cap', () => {
    expect(isValidMoneyAmount('100000000.0000001')).toBe(false);
    expect(isValidMoneyAmount('100000001')).toBe(false);
    expect(isValidMoneyAmount('999999999')).toBe(false);
  });

  it('rejects numbers with illegal leading zeros', () => {
    expect(isValidMoneyAmount('01')).toBe(false);
    expect(isValidMoneyAmount('005')).toBe(false);
    expect(isValidMoneyAmount('01.50')).toBe(false);
    // Note: single 0 before decimal is allowed
    expect(isValidMoneyAmount('0.5')).toBe(true);
  });

  it('rejects negative amounts and non-numeric strings', () => {
    expect(isValidMoneyAmount('-1')).toBe(false);
    expect(isValidMoneyAmount('-0.0000001')).toBe(false);
    expect(isValidMoneyAmount('')).toBe(false);
    expect(isValidMoneyAmount('   ')).toBe(false);
    expect(isValidMoneyAmount('abc')).toBe(false);
    expect(isValidMoneyAmount('1.2.3')).toBe(false);
    expect(isValidMoneyAmount('1.')).toBe(false);
    expect(isValidMoneyAmount('.5')).toBe(false);
  });

  it('rejects non-string values', () => {
    expect(isValidMoneyAmount(null)).toBe(false);
    expect(isValidMoneyAmount(undefined)).toBe(false);
    expect(isValidMoneyAmount(100)).toBe(false);
    expect(isValidMoneyAmount(true)).toBe(false);
    expect(isValidMoneyAmount({})).toBe(false);
    expect(isValidMoneyAmount([])).toBe(false);
    expect(isValidMoneyAmount(100n)).toBe(false);
  });
});

describe('amountToStroops', () => {
  it('converts whole numbers and fractional decimals accurately to BigInt stroops', () => {
    expect(amountToStroops('1')).toBe(10_000_000n);
    expect(amountToStroops('0.0000001')).toBe(1n);
    expect(amountToStroops('0.5')).toBe(5_000_000n);
    expect(amountToStroops('100.1234567')).toBe(1_001_234_567n);
    expect(amountToStroops('100000000')).toBe(1_000_000_000_000_000n);
  });

  it('throws an error for invalid money amounts', () => {
    expect(() => amountToStroops('0')).toThrow(/Amount must be a positive decimal string/);
    expect(() => amountToStroops('-1')).toThrow(/Amount must be a positive decimal string/);
    expect(() => amountToStroops('0.00000001')).toThrow(/Amount must be a positive decimal string/);
    expect(() => amountToStroops('100000001')).toThrow(/Amount must be a positive decimal string/);
    expect(() => amountToStroops('invalid')).toThrow(/Amount must be a positive decimal string/);
  });
});

describe('stroopsToAmount', () => {
  it('formats stroop values back to 7-decimal-place strings', () => {
    expect(stroopsToAmount(0n)).toBe('0.0000000');
    expect(stroopsToAmount(1n)).toBe('0.0000001');
    expect(stroopsToAmount(10_000_000n)).toBe('1.0000000');
    expect(stroopsToAmount(1_001_234_567n)).toBe('100.1234567');
    expect(stroopsToAmount(1_000_000_000_000_000n)).toBe('100000000.0000000');
  });

  it('throws an error for negative stroops', () => {
    expect(() => stroopsToAmount(-1n)).toThrow('Stroops amount must be non-negative');
  });
});

describe('round-trip stroops <-> amount', () => {
  it('preserves exact values across amountToStroops and stroopsToAmount', () => {
    const testCases = [
      '0.0000001',
      '1.0000000',
      '12.3456789', // 8 decimals rejected by isValidMoneyAmount
      '42.5000000',
      '100000000.0000000',
    ];

    const validTestCases = [
      '0.0000001',
      '1.0000000',
      '42.5000000',
      '100.1234567',
      '100000000.0000000',
    ];

    for (const amount of validTestCases) {
      const stroops = amountToStroops(amount);
      const formatted = stroopsToAmount(stroops);
      expect(formatted).toBe(amount);
    }
  });

  it('preserves arbitrary stroop amounts across conversions', () => {
    const stroopValues = [1n, 7n, 1234567n, 10_000_000n, 9876543210n];
    for (const stroops of stroopValues) {
      const amount = stroopsToAmount(stroops);
      expect(amountToStroops(amount)).toBe(stroops);
    }
  });
});

describe('isSupportedEscrowAsset', () => {
  it('accepts USDC and XLM', () => {
    expect(isSupportedEscrowAsset(AssetType.USDC)).toBe(true);
    expect(isSupportedEscrowAsset(AssetType.XLM)).toBe(true);
    expect(SUPPORTED_ESCROW_ASSETS).toContain(AssetType.USDC);
    expect(SUPPORTED_ESCROW_ASSETS).toContain(AssetType.XLM);
  });

  it('rejects unsupported assets and arbitrary values', () => {
    expect(isSupportedEscrowAsset('BTC')).toBe(false);
    expect(isSupportedEscrowAsset('ETH')).toBe(false);
    expect(isSupportedEscrowAsset('USDT')).toBe(false);
    expect(isSupportedEscrowAsset(null)).toBe(false);
    expect(isSupportedEscrowAsset(undefined)).toBe(false);
  });
});

describe('IsMoneyAmount and IsSupportedEscrowAsset decorators', () => {
  it('validates successfully for a valid amount and asset', async () => {
    const dto = new TestBountyFundingDto('100.5', AssetType.USDC);
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('fails validation with default messages when values are invalid', async () => {
    const dto = new TestBountyFundingDto('0', 'DOGE');
    const errors = await validate(dto);
    expect(errors.length).toBe(2);

    const amountErr = errors.find((e) => e.property === 'amount');
    const assetErr = errors.find((e) => e.property === 'asset');

    expect(amountErr?.constraints?.isMoneyAmount).toBe(
      `amount must be a positive decimal string with at most 7 fractional digits and no more than ${MAX_MONETARY_AMOUNT}`,
    );
    expect(assetErr?.constraints?.isSupportedEscrowAsset).toBe(
      `asset must be a supported escrow asset: ${SUPPORTED_ESCROW_ASSETS.join(', ')}`,
    );
  });

  it('supports custom validation message options', async () => {
    const dto = new TestCustomMoneyDto('-5', 'UNSUPPORTED');
    const errors = await validate(dto);
    expect(errors.length).toBe(2);

    const amountErr = errors.find((e) => e.property === 'amount');
    const assetErr = errors.find((e) => e.property === 'asset');

    expect(amountErr?.constraints?.isMoneyAmount).toBe('Custom invalid amount');
    expect(assetErr?.constraints?.isSupportedEscrowAsset).toBe('Custom unsupported asset');
  });
});
