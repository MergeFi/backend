import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Address,
  BASE_FEE,
  Contract,
  Keypair,
  Networks,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  scValToNative,
  xdr,
} from '@stellar/stellar-sdk';
import { AssetType } from '../common/enums';
import { AppConfig } from '../config/configuration';

/** Transaction time bound set on every invocation (`setTimeout`), in seconds. */
export const SOROBAN_TX_TIMEOUT_SECONDS = 60;
const POLL_DELAY_MS = 2000;
const SUBMISSION_RETRY_DELAY_MS = 1000;
const SUBMISSION_RETRIES = 3;
const INCLUSION_FEE_BUMP_RETRIES = 2;
/**
 * Poll at least as long as the transaction's time bound (+1 attempt), so a
 * timeout really means "outcome still unknown at expiry", not "gave up early" (#527).
 */
const POLL_ATTEMPTS =
  Math.ceil((SOROBAN_TX_TIMEOUT_SECONDS * 1000) / POLL_DELAY_MS) + 1;

/**
 * Worst-case wall-clock time for a single `invoke` call, in ms.
 *
 * Exported so the idempotency interceptor can derive its staleness window
 * from this value rather than a hardcoded constant that silently falls out
 * of sync when SOROBAN_TX_TIMEOUT_SECONDS changes (#810).
 *
 * Includes every bounded poll and TRY_AGAIN_LATER delay in invoke's retry
 * path; RPC latency remains covered by the idempotency safety multiplier.
 */
export const POLL_CEILING_MS =
  POLL_ATTEMPTS * POLL_DELAY_MS * (INCLUSION_FEE_BUMP_RETRIES + 1) +
  SUBMISSION_RETRIES *
    SUBMISSION_RETRY_DELAY_MS *
    (INCLUSION_FEE_BUMP_RETRIES + 1);

/**
 * The transaction was accepted (`sendTransaction` → PENDING) but had not
 * finalized when polling ran out. Its outcome is unknown, not failed: it may
 * still be included, so callers must not treat this as "nothing happened" (#527).
 */
export class SorobanPendingError extends Error {
  constructor(public readonly txHash: string) {
    super(
      `Timed out waiting for Soroban transaction ${txHash} to finalize; outcome unknown`,
    );
    this.name = 'SorobanPendingError';
  }
}

export interface ContractInvocationResult {
  txHash: string;
  ledger: number | null;
  returnValue: unknown;
  status: string;
}

/** A single, unpolled `getTransaction(hash)` outcome (#849). */
export interface TransactionLookup {
  status: 'SUCCESS' | 'FAILED' | 'NOT_FOUND';
  ledger: number | null;
  returnValue: unknown;
}

/**
 * A `bigint` that the escrow ABI types as `u64` rather than `i128` (#301).
 *
 * Soroban argument binding is strongly typed against the WASM export's
 * parameter types: passing `ScVal::I128` where the contract declares `u64`
 * fails host-side (conversion / `UnexpectedType` during simulation) instead
 * of degrading gracefully. Wrapping the value in this marker before handing
 * it to {@link SorobanClientService.invoke} makes the intended XDR type
 * explicit at the call site.
 */
export interface U64Arg {
  readonly __sorobanU64: bigint;
}

/** Wraps a value so {@link SorobanClientService} encodes it as `ScVal::U64`. */
export function u64(value: bigint | number | string): U64Arg {
  return { __sorobanU64: BigInt(value) };
}

/**
 * Thin wrapper around the Stellar/Soroban RPC client used to invoke the
 * escrow smart contract deployed by the sibling `mergefi-contracts` repo.
 *
 * The bounty/milestone escrow signatures below track `mergefi-contracts`'
 * `contracts/escrow/src/lib.rs`. Calls use synthetic results only when
 * SOROBAN_DRY_RUN is explicitly enabled; missing live configuration otherwise
 * fails instead of simulating a successful operation.
 *
 * Bounty/milestone escrow interface (Rust):
 *   fn fund(env, issue_id: u64, sponsor: Address, token: Address, amount: i128, deadline: u64) -> Result<(), Error>
 *   fn release(env, issue_id: u64, recipients: Vec<(Address, u32)>) -> Result<(), Error>
 *   fn refund(env, issue_id: u64) -> Result<(), Error>
 *   fn get_escrow(env, issue_id: u64) -> Option<Escrow>   (read-only; see {@link read}, #849)
 *
 * `release` is the single payout entrypoint — a lone recipient is just the
 * degenerate `[(addr, 10_000)]` case of the same `(address, basis_points)`
 * vector a team split uses; there is no separate `split_release` (#161).
 *
 * The `mergefi-maintenance-pool` contract is a distinct deposit/withdraw
 * model (no lock step): a running on-chain balance topped up by
 * any sponsor via repeated `deposit()`, paid out by an admin against the
 * live balance — see `EscrowService.poolWithdraw` (#163):
 *   fn deposit(env: Env, sponsor: Address, pool_id: BytesN<32>, amount: i128, token: Address)
 *   fn withdraw(
 *     env: Env, pool_id: u64, recipients: Vec<(Address, u32)>, amount: i128
 *   ) -> Result<(), Error>
 *
 * The `mergefi-milestones` contract is a two-step allocate/release model with
 * no "partially drain one locked escrow" primitive (#160, #162):
 * `create_milestone()` opens a budget pool, `allocate(milestone_id, issue_id,
 * amount)` reserves a slice of the unallocated remainder for one issue
 * (admin-only, rejects over-allocation), and `release_issue(milestone_id,
 * issue_id, recipients)` pays out that issue's already-reserved slice.
 * `MilestonesService.resolveIssue` therefore needs per-issue allocation
 * tracking rather than repeated `releasePartial` calls against a single
 * ever-LOCKED escrow row:
 *   fn create_milestone(env: Env, sponsor: Address, milestone_id: BytesN<32>, budget: i128, token: Address)
 *   fn allocate(env: Env, milestone_id: BytesN<32>, issue_id: BytesN<32>, amount: i128)
 *   fn release_issue(env: Env, milestone_id: BytesN<32>, issue_id: BytesN<32>, recipients: Vec<(Address, u32)>) -> i128
 */
@Injectable()
export class SorobanClientService {
  private readonly logger = new Logger(SorobanClientService.name);
  private readonly server: rpc.Server;
  private readonly networkPassphrase: string;
  private readonly stellar: AppConfig['stellar'];

  constructor(private readonly configService: ConfigService<AppConfig, true>) {
    this.stellar = this.configService.get('stellar', { infer: true });
    this.networkPassphrase = this.stellar.networkPassphrase || Networks.TESTNET;
    this.server = new rpc.Server(this.stellar.sorobanRpcUrl, {
      allowHttp: this.stellar.sorobanRpcUrl.startsWith('http://'),
    });
  }

  /** Whether a real escrow contract has been configured for this environment. */
  isConfigured(): boolean {
    return Boolean(
      this.stellar.escrowContractId && this.stellar.treasurySecret,
    );
  }

  get dryRunEnabled(): boolean {
    return this.stellar.dryRun;
  }

  get protocolFeeBps(): number {
    return this.stellar.protocolFeeBps;
  }

  get treasuryAddress(): string | null {
    return this.stellar.treasurySecret
      ? Keypair.fromSecret(this.stellar.treasurySecret).publicKey()
      : null;
  }

  /** Deployed contract ID for single-issue bounty/milestone escrows. */
  get escrowContractId(): string {
    return this.stellar.escrowContractId;
  }

  /**
   * Deployed contract ID for maintenance-pool escrows.
   *
   * Returns an empty string when `MAINTENANCE_POOL_CONTRACT_ID` is unset.
   * Callers must check `isPoolConfigured()` before invoking on-chain pool
   * operations — the escrow contract has a disjoint interface and cannot
   * service pool calls (#754).
   */
  get maintenancePoolContractId(): string {
    return this.stellar.maintenancePoolContractId;
  }

  /**
   * Whether a real maintenance-pool contract has been configured.
   * Use this guard before any `deposit`/`withdraw`/`poolWithdraw` call to
   * prevent money from being routed to the bounty escrow contract (#754).
   */
  isPoolConfigured(): boolean {
    return Boolean(this.stellar.maintenancePoolContractId);
  }

  /** Soroban token (SAC) contract address for a supported escrow asset (#158). */
  tokenContractId(asset: AssetType): string {
    return this.stellar.assetContractIds[asset] ?? '';
  }

  /** Fallback escrow deadline, in seconds from now, for escrow::fund (#158). */
  get escrowDeadlineSeconds(): number {
    return this.stellar.escrowDeadlineSeconds;
  }

  private getTreasuryKeypair(): Keypair | null {
    if (!this.stellar.treasurySecret) return null;
    return Keypair.fromSecret(this.stellar.treasurySecret);
  }

  private getContract(contractId?: string): Contract {
    const id = contractId || this.stellar.escrowContractId;
    if (!id) {
      throw new Error(
        'ESCROW_CONTRACT_ID is not configured; cannot build a contract invocation.',
      );
    }
    return new Contract(id);
  }

  /**
   * Builds, simulates, signs, and submits a contract invocation. The synthetic
   * result path is available only through the explicit SOROBAN_DRY_RUN flag;
   * callers persist dry_run ledger statuses for these results.
   */
  async invoke(
    method: string,
    args: unknown[],
    opts: { contractId?: string } = {},
  ): Promise<ContractInvocationResult> {
    if (this.dryRunEnabled) {
      this.logger.warn(
        `SOROBAN_DRY_RUN=true — dry-running "${method}" instead of submitting an on-chain transaction.`,
      );
      return {
        txHash: `dry-run-${method}-${Date.now()}`,
        ledger: null,
        returnValue: null,
        status: 'DRY_RUN',
      };
    }

    if (!this.isConfigured()) {
      throw new Error(
        `Refusing to invoke "${method}" without Soroban configuration. ` +
          'Set ESCROW_CONTRACT_ID and TREASURY_SECRET, or explicitly enable SOROBAN_DRY_RUN=true.',
      );
    }

    const keypair = this.getTreasuryKeypair();
    if (!keypair) {
      throw new Error(
        'TREASURY_SECRET is required to sign escrow transactions.',
      );
    }

    const contract = this.getContract(opts.contractId);
    const scArgs = args.map((arg) => this.toScVal(arg));
    for (let feeAttempt = 0; ; feeAttempt++) {
      const inclusionFee = this.stellar.inclusionFee * 2 ** feeAttempt;
      if (!Number.isSafeInteger(inclusionFee)) {
        throw new Error('Soroban inclusion fee escalation exceeded safe limits');
      }
      this.logger.log(
        `Submitting Soroban "${method}" with inclusion fee ${inclusionFee} stroops`,
      );

      const account = await this.server.getAccount(keypair.publicKey());
      const tx = new TransactionBuilder(account, {
        fee: String(inclusionFee),
        networkPassphrase: this.networkPassphrase,
      })
        .addOperation(contract.call(method, ...scArgs))
        .setTimeout(SOROBAN_TX_TIMEOUT_SECONDS)
        .build();

      const simulated = await this.server.simulateTransaction(tx);
      if (rpc.Api.isSimulationError(simulated)) {
        throw new Error(`Soroban simulation failed: ${simulated.error}`);
      }

      const prepared = rpc.assembleTransaction(tx, simulated).build();
      prepared.sign(keypair);
      const send = await this.submitTransaction(prepared, method);

      let result: rpc.Api.GetTransactionResponse;
      try {
        result = await this.pollTransaction(send.hash);
      } catch (error) {
        if (
          !(error instanceof SorobanPendingError) ||
          feeAttempt >= INCLUSION_FEE_BUMP_RETRIES
        ) {
          throw error;
        }
        this.logger.warn(
          `Soroban transaction ${send.hash} was not included before expiry; rebuilding "${method}" with a higher inclusion fee`,
        );
        continue;
      }

      if (result.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
        throw new Error(
          `Soroban transaction ${send.hash} did not succeed on-chain (status: ${result.status})`,
        );
      }

      return {
        txHash: send.hash,
        ledger: 'ledger' in result ? (result.ledger ?? null) : null,
        returnValue:
          'returnValue' in result && result.returnValue
            ? scValToNative(result.returnValue)
            : null,
        status: result.status,
      };
    }
  }

  private async submitTransaction(
    prepared: Parameters<rpc.Server['sendTransaction']>[0],
    method: string,
  ): Promise<{ status: 'PENDING' | 'DUPLICATE'; hash: string }> {
    for (let attempt = 0; ; attempt++) {
      const send = await this.server.sendTransaction(prepared);
      if (send.status === 'ERROR') {
        throw new Error(
          `Soroban transaction submission failed: ${JSON.stringify(send.errorResult)}`,
        );
      }
      if (send.status === 'TRY_AGAIN_LATER') {
        if (attempt >= SUBMISSION_RETRIES) {
          throw new Error(
            `Soroban transaction submission for "${method}" was rejected with TRY_AGAIN_LATER after ${attempt + 1} attempts`,
          );
        }
        this.logger.warn(
          `Soroban submission queue is full for "${method}"; retrying in ${SUBMISSION_RETRY_DELAY_MS}ms`,
        );
        await new Promise((resolve) =>
          setTimeout(resolve, SUBMISSION_RETRY_DELAY_MS),
        );
        continue;
      }
      if (send.status === 'DUPLICATE') {
        this.logger.warn(
          `Soroban reports "${method}" transaction ${send.hash} as DUPLICATE; polling the existing transaction`,
        );
        return { status: 'DUPLICATE', hash: send.hash };
      }
      if (send.status === 'PENDING') {
        return { status: 'PENDING', hash: send.hash };
      }
      throw new Error(
        `Soroban returned an unexpected submission status for "${method}": ${String(send.status)}`,
      );
    }
  }

  /**
   * One `getTransaction(hash)` lookup, no polling — what the reconciliation
   * job uses to settle an escrow left PENDING by a {@link SorobanPendingError}
   * (#849). NOT_FOUND means "not included yet, or already pruned from the
   * RPC's retention window"; callers must not read it as "failed".
   *
   * Returns null when Soroban is not configured: a dry-run hash was never
   * submitted, so there is nothing to look up.
   */
  async getTransaction(hash: string): Promise<TransactionLookup | null> {
    if (this.dryRunEnabled || !this.isConfigured()) return null;
    const res = await this.server.getTransaction(hash);
    if (res.status === rpc.Api.GetTransactionStatus.NOT_FOUND) {
      return { status: 'NOT_FOUND', ledger: null, returnValue: null };
    }
    return {
      status:
        res.status === rpc.Api.GetTransactionStatus.SUCCESS
          ? 'SUCCESS'
          : 'FAILED',
      ledger: 'ledger' in res ? (res.ledger ?? null) : null,
      returnValue:
        'returnValue' in res && res.returnValue
          ? scValToNative(res.returnValue)
          : null,
    };
  }

  /**
   * Reads contract state without submitting anything: the call is simulated
   * and its return value decoded. Used for `get_escrow(issue_id)` by the
   * reconciliation job (#849).
   *
   * Returns `undefined` when Soroban is not configured (there is no chain to
   * read), and `null` when the contract returned nothing for the key.
   */
  async read(
    method: string,
    args: unknown[],
    opts: { contractId?: string } = {},
  ): Promise<unknown> {
    const keypair = this.getTreasuryKeypair();
    if (this.dryRunEnabled || !this.isConfigured() || !keypair) {
      return undefined;
    }

    const contract = this.getContract(opts.contractId);
    const account = await this.server.getAccount(keypair.publicKey());
    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(
        contract.call(method, ...args.map((arg) => this.toScVal(arg))),
      )
      .setTimeout(SOROBAN_TX_TIMEOUT_SECONDS)
      .build();

    const simulated = await this.server.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(simulated)) {
      throw new Error(`Soroban simulation failed: ${simulated.error}`);
    }
    const retval = simulated.result?.retval;
    return retval ? (scValToNative(retval) ?? null) : null;
  }

  async getProtocolFeeBps(opts: { contractId?: string } = {}): Promise<number> {
    if (this.dryRunEnabled) return this.protocolFeeBps;
    const value = await this.read('get_fee_bps', [], opts);
    const feeBps =
      typeof value === 'bigint'
        ? Number(value)
        : typeof value === 'number'
          ? value
          : typeof value === 'string' && /^\d+$/.test(value)
            ? Number(value)
            : NaN;
    if (!Number.isSafeInteger(feeBps) || feeBps < 0 || feeBps > 10_000) {
      throw new Error(
        `Soroban get_fee_bps returned an invalid basis-point value: ${String(value)}`,
      );
    }
    return feeBps;
  }

  private async pollTransaction(
    hash: string,
    attempts = POLL_ATTEMPTS,
    delayMs = POLL_DELAY_MS,
  ): Promise<rpc.Api.GetTransactionResponse> {
    for (let i = 0; i < attempts; i++) {
      const res = await this.server.getTransaction(hash);
      if (res.status !== rpc.Api.GetTransactionStatus.NOT_FOUND) {
        return res;
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    throw new SorobanPendingError(hash);
  }

  private toScVal(value: unknown): xdr.ScVal {
    if (isU64Arg(value)) {
      // #301 — `issue_id` / `deadline` are declared u64 in the escrow ABI;
      // a bare bigint would encode as ScVal::I128 and fail host-side
      // argument binding during simulation.
      return nativeToScVal(value.__sorobanU64, { type: 'u64' });
    }
    if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
      // BytesN<32> arguments (metadata hashes, description hashes, etc.)
      // arrive as raw bytes, not strings — without this branch they fell
      // through to the generic nativeToScVal(value) call below with no
      // `bytes` type hint, which does not reliably encode a Buffer/
      // Uint8Array as ScVal bytes (#45).
      return nativeToScVal(Buffer.from(value), { type: 'bytes' });
    }
    if (Array.isArray(value)) {
      // Vec<...> arguments, including the Vec<(Address, u32)> recipients
      // list escrow::release takes. A [address, basisPoints] pair encodes
      // as an (Address, u32) tuple; anything else element-by-element (#161).
      if (this.isRecipientTuple(value)) {
        return nativeToScVal([
          new Address(value[0]).toScVal(),
          nativeToScVal(value[1], { type: 'u32' }),
        ]);
      }
      return nativeToScVal(value.map((element) => this.toScVal(element)));
    }
    if (
      typeof value === 'string' &&
      value.length >= 32 &&
      /^[A-Z0-9]+$/.test(value)
    ) {
      // Looks like a Stellar public key / contract address
      try {
        return new Address(value).toScVal();
      } catch {
        return nativeToScVal(value, { type: 'string' });
      }
    }
    if (typeof value === 'bigint') {
      return nativeToScVal(value, { type: 'i128' });
    }
    return nativeToScVal(value);
  }

  /** A `[stellarAddress, basisPoints]` pair destined for a `(Address, u32)` tuple. */
  private isRecipientTuple(value: unknown[]): value is [string, number] {
    return (
      value.length === 2 &&
      typeof value[0] === 'string' &&
      typeof value[1] === 'number'
    );
  }
}

/** Type guard for the {@link u64} marker (#301). */
function isU64Arg(value: unknown): value is U64Arg {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as U64Arg).__sorobanU64 === 'bigint'
  );
}
