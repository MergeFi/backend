'use client';

import {
  Contract,
  TransactionBuilder,
  BASE_FEE,
  Networks,
  rpc as StellarRpc,
  nativeToScVal,
  scValToNative,
  xdr,
} from '@stellar/stellar-sdk';
import { SOROBAN_RPC_URL, POLICY_CONTRACT_ID, CLAIMS_CONTRACT_ID, STELLAR_NETWORK } from './constants';
import { signTransaction } from './stellar';
import { ContractError } from './errors';

const NETWORK_PASSPHRASE =
  STELLAR_NETWORK === 'PUBLIC' ? Networks.PUBLIC : Networks.TESTNET;

// Cached singleton — avoids allocating a new HTTP connection pool on every
// contract call (issue #129). Reset to null if the URL changes at runtime.
let _rpc: StellarRpc.Server | null = null;

function getRpc(): StellarRpc.Server {
  if (!_rpc) _rpc = new StellarRpc.Server(SOROBAN_RPC_URL);
  return _rpc;
}

export async function simulateContractCall(
  contractId: string,
  method: string,
  args: xdr.ScVal[],
  callerAddress: string,
): Promise<xdr.ScVal | null> {
  const rpc     = getRpc();
  const account = await rpc.getAccount(callerAddress);
  const contract = new Contract(contractId);

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(30)
    .build();

  const result = await rpc.simulateTransaction(tx);
  if (StellarRpc.Api.isSimulationError(result)) {
    throw new ContractError(`Simulation failed: ${result.error}`);
  }
  if (!result.result?.retval) return null;
  return result.result.retval;
}

export async function buildBuyPolicyTx(
  walletAddress: string,
  productId: string,
  coverageStroops: bigint,
  oracleKey: string,
  durationDays: number,
): Promise<string> {
  const rpc      = getRpc();
  const account  = await rpc.getAccount(walletAddress);
  const contract = new Contract(POLICY_CONTRACT_ID);

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      contract.call(
        'buy_policy',
        nativeToScVal(walletAddress,    { type: 'address' }),
        nativeToScVal(productId,        { type: 'string'  }),
        nativeToScVal(coverageStroops,  { type: 'i128'    }),
        nativeToScVal(oracleKey,        { type: 'symbol'  }),
        nativeToScVal(durationDays * 86400, { type: 'u64' }),
      ),
    )
    .setTimeout(60)
    .build();

  const simResult = await rpc.simulateTransaction(tx);
  if (StellarRpc.Api.isSimulationError(simResult)) {
    throw new ContractError(`buy_policy simulation failed: ${simResult.error}`);
  }

  const assembled = StellarRpc.assembleTransaction(tx, simResult).build();
  return assembled.toXDR();
}

const TX_POLL_INTERVAL_MS = 3_000;
const TX_POLL_MAX_ATTEMPTS = 10;

async function waitForConfirmation(hash: string): Promise<string> {
  const rpc = getRpc();
  for (let attempt = 0; attempt < TX_POLL_MAX_ATTEMPTS; attempt++) {
    await new Promise((r) => setTimeout(r, TX_POLL_INTERVAL_MS));
    const status = await rpc.getTransaction(hash);
    if (status.status === 'SUCCESS') return hash;
    if (status.status === 'FAILED') {
      throw new ContractError(`Transaction failed on-chain: ${JSON.stringify((status as any).resultXdr ?? status)}`);
    }
  }
  throw new ContractError(`Transaction not confirmed after ${TX_POLL_MAX_ATTEMPTS * TX_POLL_INTERVAL_MS / 1000}s — hash: ${hash}`);
}

// invokeBuyPolicy reuses buildBuyPolicyTx so the buy_policy argument list
// lives in exactly one place — any future contract signature change only
// needs to be updated in buildBuyPolicyTx (issue #128).
export async function invokeBuyPolicy(
  walletAddress: string,
  productId: string,
  coverageStroops: bigint,
  oracleKey: string,
  durationDays: number,
): Promise<string> {
  const assembledXdr = await buildBuyPolicyTx(walletAddress, productId, coverageStroops, oracleKey, durationDays);
  const signedXdr    = await signTransaction(assembledXdr);
  const signedTx     = TransactionBuilder.fromXDR(signedXdr, NETWORK_PASSPHRASE);
  const submitResult = await getRpc().sendTransaction(signedTx);

  if (submitResult.status === 'ERROR') {
    throw new ContractError(`Transaction rejected: ${JSON.stringify(submitResult.errorResult)}`);
  }
  return waitForConfirmation(submitResult.hash);
}

export async function invokeSubmitClaim(
  walletAddress: string,
  policyId: string,
): Promise<string> {
  const rpc      = getRpc();
  const account  = await rpc.getAccount(walletAddress);
  const contract = new Contract(CLAIMS_CONTRACT_ID);

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      contract.call(
        'submit_claim',
        nativeToScVal(walletAddress, { type: 'address' }),
        nativeToScVal(policyId,      { type: 'string'  }),
      ),
    )
    .setTimeout(60)
    .build();

  const simResult = await rpc.simulateTransaction(tx);
  if (StellarRpc.Api.isSimulationError(simResult)) {
    throw new ContractError(`submit_claim simulation failed: ${simResult.error}`);
  }

  const assembled    = StellarRpc.assembleTransaction(tx, simResult).build();
  const signedXdr    = await signTransaction(assembled.toXDR());
  const signedTx     = TransactionBuilder.fromXDR(signedXdr, NETWORK_PASSPHRASE);
  const submitResult = await rpc.sendTransaction(signedTx);

  if (submitResult.status === 'ERROR') {
    throw new ContractError(`Claim transaction rejected: ${JSON.stringify(submitResult.errorResult)}`);
  }
  return waitForConfirmation(submitResult.hash);
}

export async function buildDepositTx(
  poolId: string,
  amount: bigint,
  wallet: string,
): Promise<string> {
  const rpc      = getRpc();
  const account  = await rpc.getAccount(wallet);
  const contract = new Contract(poolId);

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      contract.call(
        'deposit',
        nativeToScVal(amount, { type: 'i128' }),
        nativeToScVal(wallet, { type: 'address' }),
      ),
    )
    .setTimeout(60)
    .build();

  const simResult = await rpc.simulateTransaction(tx);
  if (StellarRpc.Api.isSimulationError(simResult)) {
    throw new ContractError(`deposit simulation failed: ${simResult.error}`);
  }

  return StellarRpc.assembleTransaction(tx, simResult).build().toXDR();
}

export async function submitSignedTransaction(signedXdr: string, confirmTimeoutMs = 30_000): Promise<string> {
  const rpc          = getRpc();
  const signedTx     = TransactionBuilder.fromXDR(signedXdr, NETWORK_PASSPHRASE);
  const submitResult = await rpc.sendTransaction(signedTx);

  if (submitResult.status === 'ERROR') {
    throw new ContractError(`Transaction rejected: ${JSON.stringify(submitResult.errorResult)}`);
  }

  const hash     = submitResult.hash;
  const deadline = Date.now() + confirmTimeoutMs;

  while (Date.now() < deadline) {
    const txResult = await rpc.getTransaction(hash);
    if (txResult.status === StellarRpc.Api.GetTransactionStatus.SUCCESS) return hash;
    if (txResult.status === StellarRpc.Api.GetTransactionStatus.FAILED) {
      throw new ContractError('Transaction failed on-chain', hash);
    }
    await new Promise<void>((r) => setTimeout(r, 2_000));
  }

  throw new ContractError(`Transaction confirmation timed out after ${confirmTimeoutMs / 1_000}s`, hash);
}
