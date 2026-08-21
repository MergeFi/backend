import { Payment } from '../common/entities';
import { AssetType, PaymentStatus } from '../common/enums';
import { toPublicPayment, toPublicPayments } from './payment-response.mapper';

function makePayment(overrides: Partial<Payment> = {}): Payment {
  return {
    id: 'pay_1',
    escrow: null as unknown as Payment['escrow'],
    escrowId: 'esc_1',
    recipient: null,
    recipientId: 'user_1',
    recipientAddress: 'GRECIPIENT',
    amount: '50.0000000',
    asset: AssetType.USDC,
    splitPercentage: '50.00',
    status: PaymentStatus.PENDING,
    txHash: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('toPublicPayment', () => {
  it('preserves every field unchanged', () => {
    const payment = makePayment();

    const publicPayment = toPublicPayment(payment);

    expect(publicPayment).toMatchObject({
      id: 'pay_1',
      escrowId: 'esc_1',
      recipientId: 'user_1',
      amount: '50.0000000',
      status: PaymentStatus.PENDING,
    });
  });
});

describe('toPublicPayments', () => {
  it('maps every payment in the array', () => {
    const payments = [
      makePayment({ id: 'pay_1' }),
      makePayment({ id: 'pay_2' }),
    ];

    const publicPayments = toPublicPayments(payments);

    expect(publicPayments).toHaveLength(2);
    expect(publicPayments.map((p) => p.id)).toEqual(['pay_1', 'pay_2']);
  });
});
