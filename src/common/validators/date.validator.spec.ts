import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { IsFutureDate } from './date.validator';

class TestDto {
  @IsFutureDate()
  deadline!: string;
}

describe('date.validator (@IsFutureDate)', () => {
  it('accepts a date strictly in the future', async () => {
    const future = new Date(Date.now() + 3_600_000).toISOString();
    const dto = plainToInstance(TestDto, { deadline: future });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('rejects a date in the past', async () => {
    const past = new Date(Date.now() - 3_600_000).toISOString();
    const dto = plainToInstance(TestDto, { deadline: past });
    expect((await validate(dto)).length).toBeGreaterThan(0);
  });

  it('rejects the current instant', async () => {
    const now = new Date().toISOString();
    const dto = plainToInstance(TestDto, { deadline: now });
    expect((await validate(dto)).length).toBeGreaterThan(0);
  });

  it('rejects a malformed date-string', async () => {
    const dto = plainToInstance(TestDto, { deadline: 'not-a-date' });
    expect((await validate(dto)).length).toBeGreaterThan(0);
  });

  it('rejects a non-string', async () => {
    const dto = plainToInstance(TestDto, { deadline: 123 as any });
    expect((await validate(dto)).length).toBeGreaterThan(0);
  });
});
