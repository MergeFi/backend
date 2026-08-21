import { validate } from 'class-validator';
import { CreateMilestoneDto } from './create-milestone.dto';
import { AssetType } from '../../common/enums';

describe('CreateMilestoneDto', () => {
  it('accepts a valid milestone DTO with future deadline', async () => {
    const dto = new CreateMilestoneDto();
    dto.repositoryId = '123e4567-e89b-12d3-a456-426614174000';
    dto.title = 'Milestone 1';
    dto.budget = '1000';
    dto.asset = AssetType.USDC;
    dto.deadline = new Date(Date.now() + 86400000).toISOString();

    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('rejects a past deadline', async () => {
    const dto = new CreateMilestoneDto();
    dto.repositoryId = '123e4567-e89b-12d3-a456-426614174000';
    dto.title = 'Milestone 1';
    dto.budget = '1000';
    dto.asset = AssetType.USDC;
    dto.deadline = new Date(Date.now() - 86400000).toISOString();

    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.property === 'deadline')).toBe(true);
  });
});
