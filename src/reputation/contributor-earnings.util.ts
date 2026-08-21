import { Repository } from 'typeorm';
import { Payment } from '../common/entities';
import { PaymentStatus } from '../common/enums';

/**
 * Computes a contributor's total lifetime earnings from confirmed Payment
 * ledger rows, ensuring team splits and individual payouts reflect the actual
 * funds received rather than full Bounty face values.
 */
export async function computeContributorTotalEarnings(
  paymentRepo: Repository<Payment>,
  recipientId: string,
): Promise<number> {
  const row = await paymentRepo
    .createQueryBuilder('payment')
    .select('COALESCE(SUM(payment.amount), 0)', 'total')
    .where('payment.recipientId = :recipientId', { recipientId })
    .andWhere('payment.status = :status', {
      status: PaymentStatus.CONFIRMED,
    })
    .getRawOne<{ total: string }>();

  return Number(row?.total ?? 0);
}
