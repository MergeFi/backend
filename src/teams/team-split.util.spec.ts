import { BadRequestException } from '@nestjs/common';
import { validateSplitPercentages } from './team-split.util';

describe('team split percentage math', () => {
  it('accepts splits that sum to exactly 100', () => {
    expect(() =>
      validateSplitPercentages([
        { userId: 'u1', percentage: 40 },
        { userId: 'u2', percentage: 40 },
        { userId: 'u3', percentage: 20 },
      ]),
    ).not.toThrow();
  });

  it('accepts splits within floating point tolerance of 100', () => {
    expect(() =>
      validateSplitPercentages([
        { userId: 'u1', percentage: 33.33 },
        { userId: 'u2', percentage: 33.33 },
        { userId: 'u3', percentage: 33.34 },
      ]),
    ).not.toThrow();
  });

  it('rejects splits that sum to less than 100', () => {
    expect(() =>
      validateSplitPercentages([
        { userId: 'u1', percentage: 40 },
        { userId: 'u2', percentage: 40 },
      ]),
    ).toThrow(BadRequestException);
  });

  it('rejects splits that sum to more than 100', () => {
    expect(() =>
      validateSplitPercentages([
        { userId: 'u1', percentage: 60 },
        { userId: 'u2', percentage: 60 },
      ]),
    ).toThrow(BadRequestException);
  });

  it('rejects a zero or negative percentage', () => {
    expect(() =>
      validateSplitPercentages([
        { userId: 'u1', percentage: 0 },
        { userId: 'u2', percentage: 100 },
      ]),
    ).toThrow(BadRequestException);
  });

  it('rejects an empty split list', () => {
    expect(() => validateSplitPercentages([])).toThrow(BadRequestException);
  });

  it('rejects duplicate member IDs in split', () => {
    expect(() =>
      validateSplitPercentages([
        { userId: 'u1', percentage: 50 },
        { userId: 'u1', percentage: 50 },
      ]),
    ).toThrow(BadRequestException);
  });
});
