import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { AssetType } from '../../common/enums';
import { FundEscrowDto } from './fund-escrow.dto';

describe('FundEscrowDto validation', () => {
  const pipe = new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  const basePayload = {
    amount: '100.0000000',
    asset: AssetType.USDC,
    funderAddress: 'GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ',
    bountyId: '11111111-1111-4111-8111-111111111111',
  };
  const metadata = { type: 'body' as const, metatype: FundEscrowDto };

  it('accepts a future ISO 8601 deadline and keeps it as a string', async () => {
    const result = await pipe.transform(
      { ...basePayload, deadline: '2030-01-01T00:00:00.000Z' },
      metadata,
    );

    expect(result).toBeInstanceOf(FundEscrowDto);
    expect(result.deadline).toBe('2030-01-01T00:00:00.000Z');
  });

  it('rejects a malformed deadline', async () => {
    await expect(
      pipe.transform({ ...basePayload, deadline: 'not-a-date' }, metadata),
    ).rejects.toThrow(BadRequestException);
  });

  it('accepts a request without a deadline', async () => {
    const result = await pipe.transform(basePayload, metadata);

    expect(result).toBeInstanceOf(FundEscrowDto);
    expect(result.deadline).toBeUndefined();
  });
});
