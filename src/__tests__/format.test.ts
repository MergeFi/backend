import {
  stroopsToDisplay,
  displayToStroops,
  formatUSDC,
  shortenAddress,
  basisPointsToPercent,
  formatOracleValue,
  timeLeft,
  estimatePremium,
} from '../lib/format';

describe('stroopsToDisplay', () => {
  it('converts exact USDC amounts', () => {
    expect(stroopsToDisplay('10000000')).toBe('1.00');
    expect(stroopsToDisplay('100000000')).toBe('10.00');
    expect(stroopsToDisplay('0')).toBe('0.00');
  });

  it('handles bigint input', () => {
    expect(stroopsToDisplay(50000000n)).toBe('5.00');
  });

  it('respects decimal precision', () => {
    expect(stroopsToDisplay('12345678', 4)).toBe('1.2345');
  });
});

describe('displayToStroops', () => {
  it('converts display amounts to stroops', () => {
    expect(displayToStroops('1')).toBe(10000000n);
    expect(displayToStroops('10.5')).toBe(105000000n);
    expect(displayToStroops('0.0000001')).toBe(1n);
  });

  it('handles amounts without decimals', () => {
    expect(displayToStroops('100')).toBe(1000000000n);
  });
});

describe('formatUSDC', () => {
  it('appends USDC symbol by default', () => {
    expect(formatUSDC('10000000')).toBe('1.00 USDC');
  });

  it('omits symbol when showSymbol is false', () => {
    expect(formatUSDC('10000000', false)).toBe('1.00');
  });
});

describe('shortenAddress', () => {
  const ADDR = 'GDYJWQZFBFZD6FMXF5Y5XJFZJZ5XFZJZ5XFZJZ5X';

  it('truncates long addresses', () => {
    const result = shortenAddress(ADDR);
    expect(result).toContain('…');
    expect(result.length).toBeLessThan(ADDR.length);
  });

  it('returns short addresses unchanged', () => {
    expect(shortenAddress('GABC')).toBe('GABC');
  });
});

describe('basisPointsToPercent', () => {
  it('converts basis points correctly', () => {
    expect(basisPointsToPercent(500)).toBe('5.00%');
    expect(basisPointsToPercent(100)).toBe('1.00%');
    expect(basisPointsToPercent(250, 1)).toBe('2.5%');
  });
});

describe('formatOracleValue', () => {
  it('formats rainfall in mm', () => {
    const result = formatOracleValue('324000000', 'weather');
    expect(result).toContain('mm');
    expect(result).toContain('32.40');
  });

  it('formats flight delay in minutes', () => {
    const result = formatOracleValue('1200000000', 'flight');
    expect(result).toContain('120');
    expect(result).toContain('min');
  });

  it('handles large values without precision loss', () => {
    // 9,007,199,254,740,991.4740991 mm rainfall
    const result = formatOracleValue('90071992547409914740991', 'weather');
    expect(result).toContain('9007199254740991.47');
  });
});

describe('estimatePremium', () => {
  it('matches on-chain integer calculation for edge case 1', () => {
    // 9999.99 coverage, 500 bps (5%)
    expect(estimatePremium('9999.99', 500)).toBe('499.99');
  });

  it('matches on-chain integer calculation for edge case 2', () => {
    // 1000.01 coverage, 333 bps (3.33%)
    expect(estimatePremium('1000.01', 333)).toBe('33.30');
  });

  it('matches on-chain integer calculation for edge case 3', () => {
    // 0.05 coverage, 100 bps (1%)
    expect(estimatePremium('0.05', 100)).toBe('0.00');
  });
});
