import { BadRequestException } from '@nestjs/common';
import { validatePercentageSplits } from './split-percentage.validator';

describe('validatePercentageSplits', () => {
  it('accepts a list that sums to exactly 100', () => {
    expect(() =>
      validatePercentageSplits([
        { percentage: 40 },
        { percentage: 40 },
        { percentage: 20 },
      ]),
    ).not.toThrow();
  });

  it('accepts a list within floating-point tolerance of 100', () => {
    expect(() =>
      validatePercentageSplits([
        { percentage: 33.33 },
        { percentage: 33.33 },
        { percentage: 33.34 },
      ]),
    ).not.toThrow();
  });

  it('rejects an empty list', () => {
    expect(() => validatePercentageSplits([])).toThrow(BadRequestException);
  });

  it('rejects a list that does not sum to 100', () => {
    expect(() =>
      validatePercentageSplits([{ percentage: 40 }, { percentage: 40 }]),
    ).toThrow(BadRequestException);
  });

  it('rejects a zero or negative percentage', () => {
    expect(() =>
      validatePercentageSplits([{ percentage: 0 }, { percentage: 100 }]),
    ).toThrow(BadRequestException);
    expect(() =>
      validatePercentageSplits([{ percentage: -10 }, { percentage: 110 }]),
    ).toThrow(BadRequestException);
  });

  it('rejects a percentage above 100 even when the total is 100', () => {
    expect(() =>
      validatePercentageSplits([{ percentage: 150 }, { percentage: -50 }]),
    ).toThrow(BadRequestException);
  });

  it('uses the supplied label in the error message', () => {
    expect(() =>
      validatePercentageSplits([{ percentage: 10 }], 'team member split'),
    ).toThrow(/team member split/);
  });
});
