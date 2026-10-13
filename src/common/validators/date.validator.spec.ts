import { validate } from 'class-validator';
import { IsFutureDate } from './date.validator';

class TestDeadlineDto {
  @IsFutureDate()
  deadline: unknown;

  constructor(deadline: unknown) {
    this.deadline = deadline;
  }
}

class TestCustomMessageDeadlineDto {
  @IsFutureDate({ message: 'Deadline must be set to a future timestamp' })
  deadline: unknown;

  constructor(deadline: unknown) {
    this.deadline = deadline;
  }
}

describe('IsFutureDate validator', () => {
  it('accepts an ISO string strictly in the future', async () => {
    const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const dto = new TestDeadlineDto(futureDate);
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('rejects an ISO string in the past', async () => {
    const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const dto = new TestDeadlineDto(pastDate);
    const errors = await validate(dto);
    expect(errors.length).toBe(1);
    expect(errors[0].constraints?.isFutureDate).toBe(
      'deadline must be a date strictly in the future',
    );
  });

  it('rejects a date set to the exact current timestamp ("now")', async () => {
    const now = 1_700_000_000_000;
    jest.spyOn(Date, 'now').mockReturnValue(now);

    const dto = new TestDeadlineDto(new Date(now).toISOString());
    const errors = await validate(dto);
    expect(errors.length).toBe(1);
    expect(errors[0].constraints?.isFutureDate).toBe(
      'deadline must be a date strictly in the future',
    );

    jest.restoreAllMocks();
  });

  it('rejects an invalid date string', async () => {
    const invalidInputs = [
      'not-a-date',
      '',
      '   ',
      '2024-99-99',
      'abc-xyz',
      '2024-13-45T99:99:99Z',
    ];

    for (const input of invalidInputs) {
      const dto = new TestDeadlineDto(input);
      const errors = await validate(dto);
      expect(errors.length).toBe(1);
      expect(errors[0].constraints?.isFutureDate).toBe(
        'deadline must be a date strictly in the future',
      );
    }
  });

  it('rejects non-string values', async () => {
    const nonStringInputs = [
      null,
      undefined,
      1234567890,
      true,
      false,
      {},
      [],
      new Date(Date.now() + 100000), // Date instances must be strings at API boundary
    ];

    for (const input of nonStringInputs) {
      const dto = new TestDeadlineDto(input);
      const errors = await validate(dto);
      expect(errors.length).toBe(1);
    }
  });

  it('supports custom validation error messages', async () => {
    const pastDate = new Date(Date.now() - 1000).toISOString();
    const dto = new TestCustomMessageDeadlineDto(pastDate);
    const errors = await validate(dto);
    expect(errors.length).toBe(1);
    expect(errors[0].constraints?.isFutureDate).toBe(
      'Deadline must be set to a future timestamp',
    );
  });
});
