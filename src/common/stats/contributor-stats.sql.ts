import { BadRequestException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { Bounty, Payment } from '../entities';
import { BountyStatus, PaymentStatus } from '../enums';
import { MERGED_BOUNTY_STATUSES } from './contributor-stats.util';

/** Max calendar-day buckets returned for a payout heatmap. */
export const HEATMAP_MAX_DAYS = 366;

export const TOP_CLIENTS_LIMIT = 10;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** UTC calendar-day expression matching `Date#toISOString().slice(0, 10)`. */
export const PAYOUT_UTC_DATE_SQL = `to_char((bounty.paidAt AT TIME ZONE 'UTC'), 'YYYY-MM-DD')`;
export const PAYMENT_UTC_DATE_SQL = `to_char((payment.createdAt AT TIME ZONE 'UTC'), 'YYYY-MM-DD')`;

const MERGED_SQL = MERGED_BOUNTY_STATUSES.map((s) => `'${s}'`).join(', ');

export interface HeatmapBucket {
  date: string;
  count: number;
}

export interface TopClientRow {
  sponsorId: string;
  totalPaid: number;
}

export interface ContributorCoreSqlStats {
  claimedCount: number;
  mergedCount: number;
  completionRate: number;
  avgReviewTimeHours: number;
  lifetimeEarnings: number;
  openBountiesClaimed: number;
  onTimeCount: number;
  onTimeDeliveryPercentage: number;
  repoCount: number;
  orgCount: number;
  languages: Record<string, number>;
  orgs: string[];
}

export interface HeatmapRange {
  from?: Date;
  toExclusive?: Date;
}

export function parseUtcDateOnly(value: string, param: string): Date {
  if (!ISO_DATE.test(value)) {
    throw new BadRequestException(`${param} must be YYYY-MM-DD`);
  }
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new BadRequestException(`${param} is not a valid calendar date`);
  }
  return date;
}

/** Inclusive UTC `from`/`to` dates; `toExclusive` is the next UTC midnight. */
export function heatmapRange(from?: string, to?: string): HeatmapRange {
  const fromDate = from ? parseUtcDateOnly(from, 'from') : undefined;
  const toDate = to ? parseUtcDateOnly(to, 'to') : undefined;
  if (fromDate && toDate && fromDate > toDate) {
    throw new BadRequestException('from must be on or before to');
  }
  if (fromDate && toDate) {
    const days = (toDate.getTime() - fromDate.getTime()) / 86_400_000 + 1;
    if (days > HEATMAP_MAX_DAYS) {
      throw new BadRequestException(
        `heatmap window cannot exceed ${HEATMAP_MAX_DAYS} days`,
      );
    }
  }
  return {
    from: fromDate,
    toExclusive: toDate ? new Date(toDate.getTime() + 86_400_000) : undefined,
  };
}

export function heatmapFromRaw(
  rows: Array<{ date: string; count: string | number }>,
): HeatmapBucket[] {
  return rows
    .map((row) => ({ date: row.date, count: Number(row.count) }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export async function queryPayoutHeatmap(
  bountyRepo: Repository<Bounty>,
  userId: string,
  range: HeatmapRange = {},
  paymentRepo?: Repository<Payment>,
): Promise<HeatmapBucket[]> {
  const qb = bountyRepo
    .createQueryBuilder('bounty')
    .select(PAYOUT_UTC_DATE_SQL, 'date')
    .addSelect('COUNT(*)', 'count')
    .where('bounty.claimedById = :userId', { userId })
    .andWhere('bounty.status = :paid', { paid: BountyStatus.PAID })
    .andWhere('bounty.paidAt IS NOT NULL');

  if (range.from) {
    qb.andWhere('bounty.paidAt >= :from', { from: range.from });
  }
  if (range.toExclusive) {
    qb.andWhere('bounty.paidAt < :toExclusive', {
      toExclusive: range.toExclusive,
    });
  }

  const bountyRows = await qb
    .groupBy(PAYOUT_UTC_DATE_SQL)
    .orderBy(PAYOUT_UTC_DATE_SQL, 'DESC')
    .limit(HEATMAP_MAX_DAYS)
    .getRawMany<{ date: string; count: string }>();

  // Also include Payment rows from milestone/maintenance-pool payouts (#272).
  let paymentRows: Array<{ date: string; count: string }> = [];
  if (paymentRepo) {
    const pQb = paymentRepo
      .createQueryBuilder('payment')
      .select(PAYMENT_UTC_DATE_SQL, 'date')
      .addSelect('COUNT(*)', 'count')
      .where('payment.recipientId = :userId', { userId })
      .andWhere('payment.status = :paid', { paid: PaymentStatus.PAID });

    if (range.from) {
      pQb.andWhere('payment.createdAt >= :from', { from: range.from });
    }
    if (range.toExclusive) {
      pQb.andWhere('payment.createdAt < :toExclusive', {
        toExclusive: range.toExclusive,
      });
    }

    paymentRows = await pQb
      .groupBy(PAYMENT_UTC_DATE_SQL)
      .orderBy(PAYMENT_UTC_DATE_SQL, 'DESC')
      .limit(HEATMAP_MAX_DAYS)
      .getRawMany<{ date: string; count: string }>();
  }

  // Merge bounty and payment rows by date.
  const merged = new Map<string, number>();
  for (const row of bountyRows) {
    merged.set(row.date, (merged.get(row.date) ?? 0) + Number(row.count));
  }
  for (const row of paymentRows) {
    merged.set(row.date, (merged.get(row.date) ?? 0) + Number(row.count));
  }

  return Array.from(merged.entries())
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export async function queryTopClients(
  bountyRepo: Repository<Bounty>,
  userId: string,
  paymentRepo?: Repository<Payment>,
): Promise<TopClientRow[]> {
  // Sum from the Payment ledger joined through escrow to get the sponsor,
  // instead of summing bounty.amount which overstates team-split bounties.
  let rows: { sponsorId: string; totalPaid: string }[] = [];
  if (paymentRepo) {
    rows = await paymentRepo
      .createQueryBuilder('payment')
      .innerJoin('payment.escrow', 'escrow')
      .select('escrow.sponsorId', 'sponsorId')
      .addSelect(
        "COALESCE(SUM(payment.amount) FILTER (WHERE payment.status = :paid AND payment.recipientId = :userId AND escrow.sponsorId IS NOT NULL), 0)",
        'totalPaid',
      )
      .setParameter('paid', PaymentStatus.PAID)
      .setParameter('userId', userId)
      .groupBy('escrow.sponsorId')
      .orderBy('totalPaid', 'DESC')
      .limit(TOP_CLIENTS_LIMIT)
      .getRawMany<{ sponsorId: string; totalPaid: string }>();
  }

  return rows.map((row) => ({
    sponsorId: row.sponsorId,
    totalPaid: Number(row.totalPaid),
  }));
}

export async function queryContributorCoreStats(
  bountyRepo: Repository<Bounty>,
  userId: string,
  paymentRepo?: Repository<Payment>,
): Promise<ContributorCoreSqlStats> {
  const [counts, languagesRows, orgsRows, paymentEarnings] = await Promise.all([
    bountyRepo
      .createQueryBuilder('bounty')
      .leftJoin('bounty.issue', 'issue')
      .leftJoin('issue.repository', 'repository')
      .select('COUNT(*)', 'claimedCount')
      .addSelect(
        `COUNT(*) FILTER (WHERE bounty.status IN (${MERGED_SQL}))`,
        'mergedCount',
      )
      .addSelect(
        `COUNT(*) FILTER (WHERE bounty.status IN ('${BountyStatus.CLAIMED}', '${BountyStatus.IN_REVIEW}'))`,
        'openBountiesClaimed',
      )
      .addSelect(
        `COALESCE(AVG(EXTRACT(EPOCH FROM (bounty.mergedAt - bounty.claimedAt)) / 3600) FILTER (WHERE bounty.status IN (${MERGED_SQL}) AND bounty.claimedAt IS NOT NULL AND bounty.mergedAt IS NOT NULL), 0)`,
        'avgReviewTimeHours',
      )
      .addSelect(
        `COUNT(*) FILTER (WHERE bounty.status IN (${MERGED_SQL}) AND (bounty.deadline IS NULL OR (bounty.mergedAt IS NOT NULL AND bounty.mergedAt <= bounty.deadline)))`,
        'onTimeCount',
      )
      .addSelect('COUNT(DISTINCT issue.repositoryId)', 'repoCount')
      .addSelect('COUNT(DISTINCT repository.owner)', 'orgCount')
      .where('bounty.claimedById = :userId', { userId })
      .getRawOne<{
        claimedCount: string;
        mergedCount: string;
        openBountiesClaimed: string;
        lifetimeEarnings: string;
        avgReviewTimeHours: string;
        onTimeCount: string;
        repoCount: string;
        orgCount: string;
      }>(),
    bountyRepo
      .createQueryBuilder('bounty')
      .innerJoin('bounty.issue', 'issue')
      .innerJoin('issue.repository', 'repository')
      .select('repository.primaryLanguage', 'lang')
      .addSelect('COUNT(*)', 'count')
      .where('bounty.claimedById = :userId', { userId })
      .andWhere('repository.primaryLanguage IS NOT NULL')
      .groupBy('repository.primaryLanguage')
      .getRawMany<{ lang: string; count: string }>(),
    bountyRepo
      .createQueryBuilder('bounty')
      .innerJoin('bounty.issue', 'issue')
      .innerJoin('issue.repository', 'repository')
      .select('DISTINCT repository.owner', 'owner')
      .where('bounty.claimedById = :userId', { userId })
      .andWhere('repository.owner IS NOT NULL')
      .getRawMany<{ owner: string }>(),
    // Also aggregate Payment rows from milestone/maintenance-pool payouts (#272).
    // This is now the sole source of truth for lifetimeEarnings — summing from
    // the Payment ledger instead of bounty.amount to correctly handle team splits.
    paymentRepo
      ? paymentRepo
          .createQueryBuilder('payment')
          .select(
            "COALESCE(SUM(payment.amount) FILTER (WHERE payment.status = :paid AND payment.recipientId = :userId), 0)",
            'totalPaid',
          )
          .setParameter('paid', PaymentStatus.PAID)
          .setParameter('userId', userId)
          .getRawOne<{ totalPaid: string }>()
      : Promise.resolve({ totalPaid: '0' }),
  ]);

  const claimedCount = Number(counts?.claimedCount ?? 0);
  const mergedCount = Number(counts?.mergedCount ?? 0);
  const onTimeCount = Number(counts?.onTimeCount ?? 0);
  const completionRate =
    claimedCount > 0 ? (mergedCount / claimedCount) * 100 : 0;
  const onTimeDeliveryPercentage =
    mergedCount > 0 ? (onTimeCount / mergedCount) * 100 : 0;

  const languages: Record<string, number> = {};
  for (const row of languagesRows) {
    languages[row.lang] = Number(row.count);
  }

  // Use the Payment ledger as the source of truth for lifetime earnings.
  const lifetimeEarnings = Number(paymentEarnings?.totalPaid ?? 0);

  return {
    claimedCount,
    mergedCount,
    completionRate,
    avgReviewTimeHours: Number(counts?.avgReviewTimeHours ?? 0),
    lifetimeEarnings,
    openBountiesClaimed: Number(counts?.openBountiesClaimed ?? 0),
    onTimeCount,
    onTimeDeliveryPercentage,
    repoCount: Number(counts?.repoCount ?? 0),
    orgCount: Number(counts?.orgCount ?? 0),
    languages,
    orgs: orgsRows.map((row) => row.owner),
  };
}
