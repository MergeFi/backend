import { getMetadataArgsStorage } from 'typeorm';
import { Payment } from './payment.entity';

describe('Payment entity indexes', () => {
  // #307: escrowId is the lookup column for every releasePartial balance
  // check, so it must carry an index.
  it('indexes escrowId as IDX_payment_escrow', () => {
    const indexes = getMetadataArgsStorage().indices.filter(
      (index) => index.target === Payment,
    );

    expect(indexes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'IDX_payment_escrow',
          columns: ['escrowId'],
        }),
      ]),
    );
  });
});
