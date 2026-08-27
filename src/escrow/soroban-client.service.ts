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
} from '@stellar/stellar-sdk';
import { AssetType } from '../common/enums';
import { AppConfig } from '../config/configuration';

export interface ContractInvocationResult {
  txHash: string;
  ledger: number | null;
  returnValue: unknown;
  status: string;
}

/**
 * Thin wrapper around the Stellar/Soroban RPC client used to invoke the
 * escrow smart contract deployed by the sibling `mergefi-contracts` repo.
 *
 * The bounty/milestone escrow signatures below track `mergefi-contracts`'
 * `contracts/escrow/src/lib.rs`. Adjust argument encoding once the real
 * generated bindings are available. Until ESCROW_CONTRACT_ID is configured,
 * calls run in "simulate-only" dry-run mode and never submit a real
 * transaction.
 *
 * Bounty/milestone escrow interface (Rust):
 *   fn fund(env, issue_id: u64, sponsor: Address, token: Address, amount: i128, deadline: u64) -> Result<(), Error>
 *   fn release(env, issue_id: u64, recipients: Vec<(Address, u32)>) -> Result<(), Error>
 *   fn refund(env, issue_id: u64) -> Result<(), Error>
 *
 * `release` is the single payout entrypoint — a lone recipient is just the
 * degenerate `[(addr, 10_000)]` case of the same `(address, basis_points)`
 * vector a team split uses; there is no separate `split_release` (#161).
 *
 * The `mergefi-maintenance-pool` contract is a distinct deposit/withdraw
 * model (no lock step, no split): a running on-chain balance topped up by
 * any sponsor via repeated `deposit()`, paid out by an admin against the
 * live balance — see `EscrowService.poolWithdraw` (#163):
 *   fn deposit(env: Env, sponsor: Address, pool_id: BytesN<32>, amount: i128, token: Address)
 *   fn withdraw(env: Env, pool_id: BytesN<32>, recipient: Address, amount: i128) -> i128
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

  /** Deployed contract ID for single-issue bounty/milestone escrows. */
  get escrowContractId(): string {
    return this.stellar.escrowContractId;
  }

  /**
   * Deployed contract ID for maintenance-pool escrows, falling back to the
   * bounty escrow contract when no separate pool deployment is configured
   * (#157).
   */
  get maintenancePoolContractId(): string {
    return (
      this.stellar.maintenancePoolContractId || this.stellar.escrowContractId
    );
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
   * Builds, simulates, signs, and submits a contract invocation. When no
   * contract ID / treasury secret is configured (local dev without deployed
   * contracts), this short-circuits into a deterministic dry-run result so
   * the rest of the orchestration (DB writes, status transitions) can still
   * be exercised end-to-end without live infrastructure.
   */
  async invoke(
    method: string,
    args: unknown[],
    opts: { contractId?: string } = {},
  ): Promise<ContractInvocationResult> {
    if (!this.isConfigured()) {
      this.logger.warn(
        `Soroban not configured (ESCROW_CONTRACT_ID/TREASURY_SECRET missing) — ` +
          `dry-running "${method}" instead of submitting an on-chain transaction.`,
      );
      return {
        txHash: `dry-run-${method}-${Date.now()}`,
        ledger: null,
        returnValue: null,
        status: 'DRY_RUN',
      };
    }

    const keypair = this.getTreasuryKeypair();
    if (!keypair) {
      throw new Error(
        'TREASURY_SECRET is required to sign escrow transactions.',
      );
    }

    const contract = this.getContract(opts.contractId);
    const account = await this.server.getAccount(keypair.publicKey());

    const scArgs = args.map((arg) => this.toScVal(arg));

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(contract.call(method, ...scArgs))
      .setTimeout(60)
      .build();

    const simulated = await this.server.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(simulated)) {
      throw new Error(`Soroban simulation failed: ${simulated.error}`);
    }

    const prepared = rpc.assembleTransaction(tx, simulated).build();
    prepared.sign(keypair);

    const send = await this.server.sendTransaction(prepared);
    if (send.status === 'ERROR') {
      throw new Error(
        `Soroban transaction submission failed: ${JSON.stringify(send.errorResult)}`,
      );
    }

    const result = await this.pollTransaction(send.hash);
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

  private async pollTransaction(
    hash: string,
    attempts = 10,
    delayMs = 2000,
  ): Promise<rpc.Api.GetTransactionResponse> {
    for (let i = 0; i < attempts; i++) {
      const res = await this.server.getTransaction(hash);
      if (res.status !== rpc.Api.GetTransactionStatus.NOT_FOUND) {
        return res;
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    throw new Error(
      `Timed out waiting for Soroban transaction ${hash} to finalize`,
    );
  }

  private toScVal(value: unknown): unknown {
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
