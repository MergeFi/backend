import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateMilestoneDto } from './create-milestone.dto';
import { AssetType } from '../../common/enums';

describe('CreateMilestoneDto validation', () => {
  const baseValidPayload = {
    repositoryId: 'c73bcdcc-2669-4bf6-81d3-e4ae73fb11fd',
    title: 'Valid Milestone Title',
    budget: '500',
    asset: AssetType.USDC,
  };

  it('accepts a valid payload and trims title whitespace', async () => {
    const dto = plainToInstance(CreateMilestoneDto, {
      ...baseValidPayload,
      title: '  Trimmed Milestone Title  ',
    });
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
    expect(dto.title).toBe('Trimmed Milestone Title');
  });

  it('rejects an empty title', async () => {
    const dto = plainToInstance(CreateMilestoneDto, {
      ...baseValidPayload,
      title: '',
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    const titleError = errors.find((e) => e.property === 'title');
    expect(titleError).toBeDefined();
    expect(titleError?.constraints?.isNotEmpty).toBeDefined();
  });

  it('rejects a whitespace-only title', async () => {
    const dto = plainToInstance(CreateMilestoneDto, {
      ...baseValidPayload,
      title: '   ',
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    const titleError = errors.find((e) => e.property === 'title');
    expect(titleError).toBeDefined();
    expect(titleError?.constraints?.isNotEmpty).toBeDefined();
  });

  it('rejects a non-string title', async () => {
    const dto = plainToInstance(CreateMilestoneDto, {
      ...baseValidPayload,
      title: 12345,
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    const titleError = errors.find((e) => e.property === 'title');
    expect(titleError).toBeDefined();
    expect(titleError?.constraints?.isString).toBeDefined();
  });
});
