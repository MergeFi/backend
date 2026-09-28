import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateTeamDto } from './create-team.dto';

describe('CreateTeamDto validation', () => {
  const baseValidPayload = {
    name: 'Valid Team Name',
    members: [
      {
        userId: 'c73bcdcc-2669-4bf6-81d3-e4ae73fb11fd',
        percentage: 100,
      },
    ],
  };

  it('accepts a valid payload and trims name whitespace', async () => {
    const dto = plainToInstance(CreateTeamDto, {
      ...baseValidPayload,
      name: '  Trimmed Team Name  ',
    });
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
    expect(dto.name).toBe('Trimmed Team Name');
  });

  it('rejects an empty name', async () => {
    const dto = plainToInstance(CreateTeamDto, {
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
    const dto = plainToInstance(CreateTeamDto, {
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
    const dto = plainToInstance(CreateTeamDto, {
      ...baseValidPayload,
      name: 12345,
    });
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    const nameError = errors.find((e) => e.property === 'name');
    expect(nameError).toBeDefined();
    expect(nameError?.constraints?.isString).toBeDefined();
  });
});
