import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreatePoolDto } from './create-pool.dto';
import { AssetType } from '../../common/enums';

describe('CreatePoolDto validation', () => {
  const baseValidPayload = {
    name: 'Valid Pool Name',
    asset: AssetType.USDC,
  };

  it('accepts a valid payload and trims name whitespace', async () => {
    const dto = plainToInstance(CreatePoolDto, {
      ...baseValidPayload,
      name: '  Trimmed Pool Name  ',
    });
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
    expect(dto.name).toBe('Trimmed Pool Name');
  });

  it('rejects an empty name', async () => {
    const dto = plainToInstance(CreatePoolDto, {
      ...baseValidPayload,
      name: '',
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    const nameError = errors.find((e) => e.property === 'name');
    expect(nameError).toBeDefined();
    expect(nameError?.constraints?.isNotEmpty).toBeDefined();
  });

  it('rejects a whitespace-only name', async () => {
    const dto = plainToInstance(CreatePoolDto, {
      ...baseValidPayload,
      name: '   ',
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    const nameError = errors.find((e) => e.property === 'name');
    expect(nameError).toBeDefined();
    expect(nameError?.constraints?.isNotEmpty).toBeDefined();
  });

  it('rejects a non-string name', async () => {
    const dto = plainToInstance(CreatePoolDto, {
      ...baseValidPayload,
      name: 999,
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    const nameError = errors.find((e) => e.property === 'name');
    expect(nameError).toBeDefined();
    expect(nameError?.constraints?.isString).toBeDefined();
  });
});
