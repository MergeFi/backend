import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Not, Repository } from 'typeorm';
import { Escrow, Payment } from '../common/entities';
import { EscrowStatus } from '../common/enums';
import { amountToStroops } from '../common/validators/money.validator';
import {
  SOROBAN_TX_TIMEOUT_SECONDS,
  SorobanClientService,
  u64,
} from './soroban-client.service';

/** Rows examined per run; the oldest-touched rows go first so none starve. */
export const RECONCILIATION_BATCH_SIZE = 50;

/**
 * Extra time past the transaction's own time bound before a NOT_FOUND hash
 * is treated as "never included" rather than "not included yet".
 */
const PENDING_GRACE_MS = 60_000;

export type OnChainEscrowStatus =
  'locked' | 'released' | 'refunded' | 'unknown';

/** The parts of `get_escrow(issue_id)` the reconciler compares against. */
export interface OnChainEscrowRecord {
  status: OnChainEscrowStatus;
  /** Total locked, in stroops, when the record reports it. */
  amount: bigint | null;
  /** Cumulative amount paid out, in stroops, when the record reports it. */
  released: bigint | null;
}

/** What one run did, for the scheduler's log line and for tests. */
export interface ReconciliationSummary {
  examined: number;
  resolved: number;
  unresolved: number;
  skipped: number;
}

type Outcome = 'resolved' | 'unresolved' | 'skipped';

type Verdict =
  | { resolved: true; status: EscrowStatus; onChainStatus: string }
  | {
      resolved: false;
      reason: string;
      /** Set when the row must stop accepting LOCKED-only operations. */
      status?: EscrowStatus;
      onChainStatus?: string;
    };

/**
 * Repairs Escrow rows whose local state may disagree with the chain (#849).
 *
 * `EscrowService` deliberately never guesses after an ambiguous failure: it
 * keeps the truthful status and records what happened in `metadata`. This is
 * the job those records were written for. Three kinds of row are picked up:
 *
 *  - PENDING with `metadata.pending.txHash` — `fund` timed out waiting for
 *    its transaction (#527). `getTransaction(hash)` settles it to LOCKED or
 *    FAILED; once the hash is past its time bound and still unknown to the
 *    RPC, `get_escrow` decides.
 *  - LOCKED with `metadata.lastFailure` — a fund/release/refund whose outcome
 *    was not recorded (#42, #89, #302). The on-chain escrow record decides.
 *  - RECONCILIATION_PENDING, or `metadata.reconciliation.resolved === false`
 *    — a release whose Payment rows may not match what the contract did
 *    (#814), or a row an earlier run could not resolve.
 *
 * A row the job cannot settle on evidence is left flagged as
 * `metadata.reconciliation = { resolved: false, reason, checkedAt }` — the
 * queryable state {@link findUnresolved} reads — rather than only logged.
 */
@Injectable()
export class EscrowReconciliationService {
  private readonly logger = new Logger(EscrowReconciliationService.name);

  constructor(
    @InjectRepository(Escrow) private readonly escrowRepo: Repository<Escrow>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly soroban: SorobanClientService,
  ) {}

  async reconcileAll(): Promise<ReconciliationSummary> {
    const summary: ReconciliationSummary = {
      examined: 0,
      resolved: 0,
      unresolved: 0,
      skipped: 0,
    };
    // Dry-run never touched a chain, so there is nothing to reconcile against.
    if (!this.soroban.isConfigured()) return summary;

    const candidates = await this.findCandidates();
    for (const escrow of candidates) {
      summary.examined++;
      let outcome: Outcome;
      try {
        outcome = await this.reconcileOne(escrow);
      } catch (err) {
        // One bad row (RPC hiccup, decode error) must not stall the batch.
        this.logger.warn(
          `Reconciliation of escrow ${escrow.id} failed: ${(err as Error).message}`,
        );
        outcome = 'skipped';
      }
      summary[outcome]++;
    }
    return summary;
  }

  /** Rows a previous run flagged and could not settle: the queryable surface (#849). */
  findUnresolved(): Promise<Escrow[]> {
    return this.escrowRepo
      .createQueryBuilder('escrow')
      .where(`escrow.metadata -> 'reconciliation' ->> 'resolved' = 'false'`)
      .orderBy('escrow.updatedAt', 'ASC')
      .getMany();
  }

  private findCandidates(): Promise<Escrow[]> {
    return this.escrowRepo
      .createQueryBuilder('escrow')
      .where(
        `((escrow.status = :pending AND escrow.metadata -> 'pending' ->> 'txHash' IS NOT NULL)
          OR (escrow.status IN (:...fundAttemptStatuses)
          AND escrow.metadata @> '{"attempts":[{"status":"pending"}]}'))`,
        {
          pending: EscrowStatus.PENDING,
          fundAttemptStatuses: [
            EscrowStatus.PENDING,
            EscrowStatus.FAILED,
            EscrowStatus.LOCKED,
          ],
        },
      )
      .orWhere(
        `(escrow.status = :locked AND escrow.metadata -> 'lastFailure' IS NOT NULL)`,
        { locked: EscrowStatus.LOCKED },
      )
      .orWhere('escrow.status = :diverged', {
        diverged: EscrowStatus.RECONCILIATION_PENDING,
      })
      .orWhere(`escrow.metadata -> 'reconciliation' ->> 'resolved' = 'false'`)
      .orderBy('escrow.updatedAt', 'ASC')
      .take(RECONCILIATION_BATCH_SIZE)
      .getMany();
  }

  private async reconcileOne(escrow: Escrow): Promise<Outcome> {
    const pendingHash = this.pendingTxHash(escrow);
    if (
      pendingHash &&
      [EscrowStatus.PENDING, EscrowStatus.FAILED, EscrowStatus.LOCKED].includes(
        escrow.status,
      )
    ) {
      return this.reconcilePendingFund(escrow, pendingHash);
    }
    return this.reconcileAgainstRecord(escrow);
  }

  /** PENDING after a {@link SorobanPendingError}: did the fund transaction land? */
  private async reconcilePendingFund(
    escrow: Escrow,
    txHash: string,
  ): Promise<Outcome> {
    const lookup = await this.soroban.getTransaction(txHash);
    if (!lookup) return 'skipped';

    if (lookup.status === 'SUCCESS') {
      return this.apply(escrow, (row) => {
        const hasAttempt = this.hasFundAttempt(row, txHash);
        row.status = EscrowStatus.LOCKED;
        row.fundTxHash = txHash;
        row.lockedAt = row.lockedAt ?? new Date();
        this.resolveFundAttempt(row, txHash, {
          status: 'succeeded',
          result: { ...lookup, txHash },
          reconciledAt: new Date().toISOString(),
        });
        row.metadata = {
          ...omit(row.metadata, 'pending'),
          ...(hasAttempt ? {} : { fund: { ...lookup, txHash } }),
          reconciliation: this.resolvedMarker(row, 'locked'),
        };
        return 'resolved';
      });
    }

    if (lookup.status === 'FAILED') {
      // Included and failed: nothing was locked, so FAILED is truthful.
      return this.apply(escrow, (row) => {
        const hasAttempt = this.hasFundAttempt(row, txHash);
        const alreadyLocked =
          row.status === EscrowStatus.LOCKED &&
          row.fundTxHash !== null &&
          row.fundTxHash !== txHash;
        row.status = alreadyLocked ? EscrowStatus.LOCKED : EscrowStatus.FAILED;
        this.resolveFundAttempt(row, txHash, {
          status: 'failed',
          error: `fund transaction ${txHash} failed on-chain`,
          reconciledAt: new Date().toISOString(),
        });
        row.metadata = {
          ...omit(row.metadata, 'pending'),
          ...(hasAttempt
            ? {}
            : { error: `fund transaction ${txHash} failed on-chain` }),
          reconciliation: this.resolvedMarker(
            row,
            alreadyLocked ? 'locked' : 'failed',
          ),
        };
        return 'resolved';
      });
    }

    // NOT_FOUND inside the time bound: it may still be included. Wait.
    const submittedAt = this.pendingSubmittedAt(escrow, txHash);
    const expiresAt =
      submittedAt + SOROBAN_TX_TIMEOUT_SECONDS * 1000 + PENDING_GRACE_MS;
    if (Date.now() < expiresAt) return 'skipped';

    // Past its time bound the hash is either expired or pruned from the RPC's
    // retention window. The contract's own record tells the two apart.
    const record = await this.readRecord(escrow);
    if (record === undefined) return 'skipped';

    const competing = escrow.onChainId
      ? await this.escrowRepo.count({
          where: {
            id: Not(escrow.id),
            onChainId: escrow.onChainId,
            status: Not(EscrowStatus.FAILED),
          },
        })
      : 0;

    return this.apply(escrow, (row) => {
      if (record === null) {
        const hasAttempt = this.hasFundAttempt(row, txHash);
        const alreadyLocked =
          row.status === EscrowStatus.LOCKED &&
          row.fundTxHash !== null &&
          row.fundTxHash !== txHash;
        row.status = alreadyLocked ? EscrowStatus.LOCKED : EscrowStatus.FAILED;
        this.resolveFundAttempt(row, txHash, {
          status: 'expired',
          error: `fund transaction ${txHash} expired without being included`,
          reconciledAt: new Date().toISOString(),
        });
        row.metadata = {
          ...omit(row.metadata, 'pending'),
          ...(hasAttempt
            ? {}
            : {
                error: `fund transaction ${txHash} expired without being included`,
              }),
          reconciliation: this.resolvedMarker(
            row,
            alreadyLocked ? 'locked' : 'not_found',
          ),
        };
        return 'resolved';
      }
      // A record exists — but another row for the same issue_id may own it
      // (a later retry), so it is only attributable when this row is alone.
      if (record.status === 'locked' && competing === 0) {
        row.status = EscrowStatus.LOCKED;
        row.fundTxHash = txHash;
        row.lockedAt = row.lockedAt ?? new Date();
        this.resolveFundAttempt(row, txHash, {
          status: 'succeeded',
          reconciledByRecord: true,
          reconciledAt: new Date().toISOString(),
        });
        row.metadata = {
          ...omit(row.metadata, 'pending'),
          reconciliation: this.resolvedMarker(row, 'locked'),
        };
        return 'resolved';
      }
      this.flag(
        row,
        competing > 0
          ? `fund transaction ${txHash} is unknown to the RPC and another escrow row shares on-chain id ${row.onChainId}`
          : `fund transaction ${txHash} is unknown to the RPC and the on-chain record is ${record.status}`,
        record.status,
      );
      return 'unresolved';
    });
  }

  /** LOCKED with lastFailure, or a flagged/diverged release: compare with get_escrow. */
  private async reconcileAgainstRecord(escrow: Escrow): Promise<Outcome> {
    if (escrow.maintenancePoolId) {
      // The pool contract is a running balance with no per-escrow record to
      // read back, so a failed withdraw cannot be verified here.
      return this.apply(escrow, (row) => {
        this.flag(
          row,
          'maintenance-pool escrows have no get_escrow record; verify the withdraw against the pool contract manually',
        );
        return 'unresolved';
      });
    }

    const record = await this.readRecord(escrow);
    if (record === undefined) return 'skipped';

    return this.apply(escrow, async (row, manager) => {
      const payments = await manager.find(Payment, {
        where: { escrowId: row.id },
      });
      const paid = payments.reduce(
        (sum, p) => sum + amountToStroops(p.amount),
        0n,
      );
      const verdict = this.judge(row, record, paid);

      if (verdict.resolved) {
        row.status = verdict.status;
        if (verdict.status === EscrowStatus.RELEASED) {
          row.releasedAt = row.releasedAt ?? new Date();
        }
        if (verdict.status === EscrowStatus.REFUNDED) {
          row.refundedAt = row.refundedAt ?? new Date();
        }
        const lastFailure = row.metadata?.lastFailure;
        row.metadata = {
          ...omit(row.metadata, 'lastFailure'),
          reconciliation: {
            ...this.resolvedMarker(row, verdict.onChainStatus),
            ...(lastFailure ? { clearedFailure: lastFailure } : {}),
          },
        };
        return 'resolved';
      }

      if (verdict.status) row.status = verdict.status;
      this.flag(row, verdict.reason, verdict.onChainStatus);
      return 'unresolved';
    });
  }

  /**
   * Decides the truthful local state from the on-chain record and the
   * recorded payments, or explains why it cannot. Payment rows are never
   * invented: who was paid is not something the record carries, so a release
   * with missing or mismatched payments is left for a person.
   */
  private judge(
    escrow: Escrow,
    record: OnChainEscrowRecord | null,
    paid: bigint,
  ): Verdict {
    const total = amountToStroops(escrow.amount);
    if (record === null) {
      return {
        resolved: false,
        reason: `no on-chain escrow record for issue_id ${escrow.onChainId}`,
      };
    }

    switch (record.status) {
      case 'locked':
        if (paid === 0n || record.released === paid) {
          return {
            resolved: true,
            status: EscrowStatus.LOCKED,
            onChainStatus: 'locked',
          };
        }
        return {
          resolved: false,
          reason: `contract still holds funds but ${paid} stroops of payments are recorded`,
          onChainStatus: 'locked',
        };

      case 'released': {
        // A #814 divergence was raised by the contract reporting a different
        // total, so only the record's own amount can clear it.
        const diverged = 'returnedStroops' in this.reconciliationOf(escrow);
        const amountMatches =
          record.amount === null ? !diverged : record.amount === total;
        if (paid === total && amountMatches) {
          return {
            resolved: true,
            status: EscrowStatus.RELEASED,
            onChainStatus: 'released',
          };
        }
        return {
          resolved: false,
          reason: !amountMatches
            ? `released on-chain for ${record.amount ?? 'an unreported amount'} stroops but ${total} stroops are recorded`
            : `released on-chain but recorded payments total ${paid} of ${total} stroops`,
          // A LOCKED row would accept another release against a settled escrow.
          status: EscrowStatus.RECONCILIATION_PENDING,
          onChainStatus: 'released',
        };
      }

      case 'refunded':
        if (paid === 0n) {
          return {
            resolved: true,
            status: EscrowStatus.REFUNDED,
            onChainStatus: 'refunded',
          };
        }
        return {
          resolved: false,
          reason: `refunded on-chain but ${paid} stroops of payments are recorded`,
          status: EscrowStatus.RECONCILIATION_PENDING,
          onChainStatus: 'refunded',
        };

      default:
        return {
          resolved: false,
          reason: 'on-chain escrow record has an unrecognised status',
          onChainStatus: 'unknown',
        };
    }
  }

  /**
   * Re-reads the row under a pessimistic lock and applies `change` only if it
   * is still in the state the chain was checked against — a release or a
   * retry that landed in between wins, and the next run re-examines the row.
   */
  private apply(
    escrow: Escrow,
    change: (row: Escrow, manager: EntityManager) => Outcome | Promise<Outcome>,
  ): Promise<Outcome> {
    return this.dataSource.transaction(async (manager) => {
      const row = await manager.findOne(Escrow, {
        where: { id: escrow.id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!row || this.fingerprint(row) !== this.fingerprint(escrow)) {
        return 'skipped';
      }
      const outcome = await change(row, manager);
      await manager.save(Escrow, row);
      if (outcome === 'unresolved') {
        this.logger.warn(
          `Escrow ${row.id} needs manual reconciliation: ${this.reason(row)}`,
        );
      }
      return outcome;
    });
  }

  private async readRecord(
    escrow: Escrow,
  ): Promise<OnChainEscrowRecord | null | undefined> {
    if (escrow.onChainId == null || escrow.onChainId === '') return null;
    const raw = await this.soroban.read(
      'get_escrow',
      [u64(escrow.onChainId)],
      escrow.contractId ? { contractId: escrow.contractId } : {},
    );
    if (raw === undefined) return undefined;
    return parseOnChainEscrow(raw);
  }

  private flag(row: Escrow, reason: string, onChainStatus?: string): void {
    const previous = this.reconciliationOf(row);
    row.metadata = {
      ...(row.metadata ?? {}),
      reconciliation: {
        ...previous,
        resolved: false,
        reason,
        ...(onChainStatus ? { onChainStatus } : {}),
        checkedAt: new Date().toISOString(),
      },
    };
  }

  private resolvedMarker(
    row: Escrow,
    onChainStatus: string,
  ): Record<string, unknown> {
    const now = new Date().toISOString();
    return {
      ...omit(this.reconciliationOf(row), 'reason'),
      resolved: true,
      onChainStatus,
      checkedAt: now,
      resolvedAt: now,
    };
  }

  private reconciliationOf(row: Escrow): Record<string, unknown> {
    const value = row.metadata?.reconciliation;
    return value && typeof value === 'object'
      ? (value as Record<string, unknown>)
      : {};
  }

  private reason(row: Escrow): string {
    const reason = this.reconciliationOf(row).reason;
    return typeof reason === 'string' ? reason : 'unknown';
  }

  private pendingTxHash(escrow: Escrow): string | null {
    const attempt = this.fundAttempts(escrow).find(
      (candidate) =>
        candidate.status === 'pending' &&
        typeof candidate.txHash === 'string',
    );
    if (attempt && typeof attempt.txHash === 'string') return attempt.txHash;
    const pending = escrow.metadata?.pending as
      { txHash?: unknown } | undefined;
    return typeof pending?.txHash === 'string' ? pending.txHash : null;
  }

  private pendingSubmittedAt(escrow: Escrow, txHash: string): number {
    const attempt = this.fundAttempts(escrow).find(
      (candidate) =>
        candidate.status === 'pending' && candidate.txHash === txHash,
    );
    const attemptAt = typeof attempt?.at === 'string' ? attempt.at : undefined;
    const pending = escrow.metadata?.pending as { at?: unknown } | undefined;
    const at =
      typeof attemptAt === 'string'
        ? Date.parse(attemptAt)
        : typeof pending?.at === 'string'
          ? Date.parse(pending.at)
          : NaN;
    return Number.isNaN(at) ? escrow.updatedAt.getTime() : at;
  }

  private fundAttempts(escrow: Escrow): Record<string, unknown>[] {
    const attempts = escrow.metadata?.attempts;
    if (!Array.isArray(attempts)) return [];
    return attempts.filter(
      (attempt): attempt is Record<string, unknown> =>
        typeof attempt === 'object' &&
        attempt !== null &&
        !Array.isArray(attempt),
    );
  }

  private resolveFundAttempt(
    escrow: Escrow,
    txHash: string,
    update: Record<string, unknown>,
  ): void {
    const metadata = escrow.metadata ?? {};
    const attempts = this.fundAttempts(escrow);
    const index = attempts.findIndex((attempt) => attempt.txHash === txHash);
    if (index < 0) return;
    const resolved = [...attempts];
    resolved[index] = { ...resolved[index], ...update };
    escrow.metadata = { ...metadata, attempts: resolved };
  }

  private hasFundAttempt(escrow: Escrow, txHash: string): boolean {
    return this.fundAttempts(escrow).some(
      (attempt) => attempt.txHash === txHash,
    );
  }

  /** The fields whose change means someone else acted on the row meanwhile. */
  private fingerprint(escrow: Escrow): string {
    const metadata = escrow.metadata ?? {};
    return JSON.stringify([
      escrow.status,
      this.pendingTxHash(escrow),
      metadata.lastFailure ?? null,
      escrow.releaseTxHash,
      escrow.refundTxHash,
    ]);
  }
}

function omit(
  value: Record<string, unknown> | null | undefined,
  key: string,
): Record<string, unknown> {
  const copy = { ...(value ?? {}) };
  delete copy[key];
  return copy;
}

/**
 * Decodes `get_escrow`'s `Option<Escrow>` as `scValToNative` returns it.
 * A unit enum variant decodes as `['Locked']`, a symbol as `'Locked'`;
 * both are accepted, case-insensitively. `null` means no record exists.
 */
export function parseOnChainEscrow(raw: unknown): OnChainEscrowRecord | null {
  if (raw == null) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { status: 'unknown', amount: null, released: null };
  }
  const record = raw as Record<string, unknown>;
  return {
    status: normalizeStatus(record.status),
    amount: toBigInt(record.amount),
    released: toBigInt(record.released ?? record.released_amount),
  };
}

function normalizeStatus(value: unknown): OnChainEscrowStatus {
  const raw: unknown = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== 'string') return 'unknown';
  switch (raw.toLowerCase()) {
    case 'locked':
    case 'funded':
    case 'active':
      return 'locked';
    case 'released':
    case 'paid':
      return 'released';
    case 'refunded':
      return 'refunded';
    default:
      return 'unknown';
  }
}

function toBigInt(value: unknown): bigint | null {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number' && Number.isInteger(value)) {
    return BigInt(value);
  }
  if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) {
    return BigInt(value.trim());
  }
  return null;
}
