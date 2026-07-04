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
 * TODO(mergefi-contracts): this client assumes a contract exposing
 * `fund`, `release`, `refund`, and `split_release` functions with the
 * signatures documented below. Adjust argument encoding once the real
 * contract interface (from the Soroban contract's generated bindings) is
 * available. Until ESCROW_CONTRACT_ID is configured, calls run in
 * "simulate-only" dry-run mode and never submit a real transaction.
 *
 * Expected contract interface (Rust, illustrative):
 *   fn fund(env: Env, funder: Address, bounty_id: BytesN<32>, amount: i128, token: Address)
 *   fn release(env: Env, bounty_id: BytesN<32>, recipient: Address) -> i128
 *   fn split_release(env: Env, bounty_id: BytesN<32>, recipients: Vec<Address>, bps: Vec<u32>) -> i128
 *   fn refund(env: Env, bounty_id: BytesN<32>) -> i128
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

  private toScVal(value: unknown) {
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
}
