import { Repository } from 'typeorm';
import { Payment } from '../entities';
import { PaymentStatus } from '../enums';

export interface ContributorEarningsInfo {
  totalEarnings: number;
  earningsBySponsor: Map<string, number>;
}

/**
 * Calculates the total lifetime earnings for a contributor from the Payment ledger.
 * This sums actual confirmed payments rather than workflow-state proxies (like Bounty.amount),
 * ensuring accurate figures for team-split payouts.
 */
export async function calculateContributorEarnings(
  paymentRepo: Repository<Payment>,
  userId: string,
): Promise<ContributorEarningsInfo> {
  const rows = await paymentRepo
    .createQueryBuilder('payment')
    .innerJoin('payment.escrow', 'escrow')
    .select('escrow.sponsorId', 'sponsorId')
    .addSelect('SUM(payment.amount)', 'total')
    .where('payment.recipientId = :userId', { userId })
    .andWhere('payment.status = :status', { status: PaymentStatus.CONFIRMED })
    .groupBy('escrow.sponsorId')
    .getRawMany<{ sponsorId: string | null; total: string }>();

  let totalEarnings = 0;
  const earningsBySponsor = new Map<string, number>();

  for (const row of rows) {
    const amount = Number(row.total ?? 0);
    totalEarnings += amount;
    if (row.sponsorId) {
      earningsBySponsor.set(row.sponsorId, amount);
    }
  }

  return { totalEarnings, earningsBySponsor };
}
