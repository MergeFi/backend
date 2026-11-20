import { ConfigService } from '@nestjs/config';
import { Keypair, StrKey, xdr } from '@stellar/stellar-sdk';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { Escrow, Payment, User } from '../src/common/entities';
import { AssetType, EscrowStatus } from '../src/common/enums';
import { AppConfig } from '../src/config/configuration';
import { EscrowService } from '../src/escrow/escrow.service';
import {
  ContractInvocationResult,
  SorobanClientService,
  u64,
} from '../src/escrow/soroban-client.service';

/**
 * Decoded-XDR assertions for every contract invocation the backend makes
 * (#840).
 *
 * `SorobanClientService.toScVal` is the only place the backend's intent is
 * translated into the contract ABI, and a wrong ScVal type only surfaces as
 * a host-side binding error during simulation against a real deployment —
 * environments explicitly configured for dry-run never encode transactions.
 * soroban-client.service.spec.ts runs under the unit Jest config,
 * which maps @stellar/stellar-sdk to a stub whose nativeToScVal is the
 * identity, so it can only assert what the encoder *asked for*. This file
 * lives under the e2e config, which loads the real SDK, so it asserts on the
 * `xdr.ScVal` actually produced.
 *
 * Expected types are the `mergefi-contracts` signatures documented on
 * SorobanClientService:
 *   escrow::fund(issue_id: u64, sponsor: Address, token: Address, amount: i128, deadline: u64)
 *   escrow::release(issue_id: u64, recipients: Vec<(Address, u32)>)
 *   escrow::refund(issue_id: u64)
 */

type ScValType = xdr.ScValType['name'];

const ADDRESS_A = Keypair.random().publicKey();
const ADDRESS_B = Keypair.random().publicKey();
const ADDRESS_C = Keypair.random().publicKey();
const USDC_TOKEN = StrKey.encodeContract(Buffer.alloc(32, 7));

const stellarConfig: AppConfig['stellar'] = {
  network: 'testnet',
  sorobanRpcUrl: 'http://localhost:8000/rpc',
  networkPassphrase: 'Test SDF Network ; September 2015',
  escrowContractId: '',
  maintenancePoolContractId: '',
  treasurySecret: '',
  assetContractIds: { USDC: USDC_TOKEN, XLM: '' },
  escrowDeadlineSeconds: 7776000,
  dryRun: false,
  inclusionFee: 5000,
  protocolFeeBps: 250,
};

function makeSoroban(): SorobanClientService {
  return new SorobanClientService({
    get: () => stellarConfig,
  } as unknown as ConfigService<AppConfig, true>);
}

/** The real encoder, reached through the same private hook the unit spec uses. */
function encode(soroban: SorobanClientService, value: unknown): xdr.ScVal {
  return (soroban as unknown as { toScVal(v: unknown): xdr.ScVal }).toScVal(
    value,
  );
}

const typeOf = (val: xdr.ScVal): ScValType => val.switch().name;

/** A `Vec<(Address, u32)>` element, as the type names of its two fields. */
const pairTypes = (val: xdr.ScVal): ScValType[] =>
  (val.vec() ?? []).map(typeOf);

describe('SorobanClientService XDR encoding (#840)', () => {
  const soroban = makeSoroban();

  describe('encoder primitives', () => {
    it('encodes u64(1n) as scvU64', () => {
      const val = encode(soroban, u64(1n));
      expect(typeOf(val)).toBe('scvU64');
      expect(val.u64().toBigInt()).toBe(1n);
    });

    it('encodes a bare bigint amount as scvI128', () => {
      const val = encode(soroban, 10_000_000n);
      expect(typeOf(val)).toBe('scvI128');
    });

    it('encodes a Stellar account id as scvAddress', () => {
      expect(typeOf(encode(soroban, ADDRESS_A))).toBe('scvAddress');
    });

    it('encodes a contract id as scvAddress', () => {
      expect(typeOf(encode(soroban, USDC_TOKEN))).toBe('scvAddress');
    });

    it('encodes an [address, 10000] pair as a two-element scvVec of scvAddress and scvU32', () => {
      const val = encode(soroban, [ADDRESS_A, 10_000]);
      expect(typeOf(val)).toBe('scvVec');
      expect(pairTypes(val)).toEqual(['scvAddress', 'scvU32']);
      expect(val.vec()![1].u32()).toBe(10_000);
    });

    it('encodes a recipients list as an scvVec of (scvAddress, scvU32) pairs', () => {
      const val = encode(soroban, [
        [ADDRESS_A, 6000],
        [ADDRESS_B, 4000],
      ]);
      expect(typeOf(val)).toBe('scvVec');
      const pairs = val.vec()!;
      expect(pairs).toHaveLength(2);
      for (const pair of pairs) {
        expect(typeOf(pair)).toBe('scvVec');
        expect(pairTypes(pair)).toEqual(['scvAddress', 'scvU32']);
      }
      expect(pairs.map((p) => p.vec()![1].u32())).toEqual([6000, 4000]);
    });

    it('encodes a Buffer as scvBytes', () => {
      expect(typeOf(encode(soroban, Buffer.alloc(32, 1)))).toBe('scvBytes');
    });
  });

  /**
   * Drives each EscrowService entrypoint that reaches the contract and runs
   * the argument list it hands `invoke` through the real encoder, so a wrong
   * argument at a call site is caught here, not only a wrong encoder branch.
   */
  describe('per-method invocations made by EscrowService', () => {
    let invocations: Array<{ method: string; args: xdr.ScVal[] }>;
    let escrow: Escrow;
    let service: EscrowService;

    beforeEach(() => {
      invocations = [];
      escrow = {
        id: '0b4e3a2c-7c9e-4d6b-8f1a-2b3c4d5e6f70',
        amount: '100.0000000',
        asset: AssetType.USDC,
        status: EscrowStatus.LOCKED,
        onChainId: '123456789',
        contractId: null,
        bountyId: null,
        milestoneId: null,
        maintenancePoolId: null,
        metadata: null,
      } as unknown as Escrow;

      // Dry-run-shaped stand-in that records the *encoded* args and delegates
      // everything else EscrowService reads to the real client.
      const capturing = Object.create(soroban) as SorobanClientService;
      Object.defineProperty(capturing, 'dryRunEnabled', { value: true });
      capturing.getProtocolFeeBps = async () => 0;
      capturing.invoke = (
        method: string,
        args: unknown[],
      ): Promise<ContractInvocationResult> => {
        invocations.push({ method, args: args.map((a) => encode(soroban, a)) });
        return Promise.resolve({
          txHash: `dry-run-${method}`,
          ledger: null,
          returnValue: null,
          status: 'DRY_RUN',
        });
      };

      const passthrough = <T>(v: T) => Promise.resolve(v);
      const manager = {
        findOne: () => Promise.resolve(escrow),
        find: () => Promise.resolve([]),
        save: (_entity: unknown, v: unknown) => passthrough(v),
      } as unknown as EntityManager;
      const repo = {
        create: (v: unknown) => v,
        save: passthrough,
        findOne: () => Promise.resolve(escrow),
        find: () => Promise.resolve([]),
      };
      const dataSource = {
        transaction: (fn: (m: EntityManager) => Promise<unknown>) =>
          fn(manager),
      } as unknown as DataSource;

      service = new EscrowService(
        repo as unknown as Repository<Escrow>,
        repo as unknown as Repository<Payment>,
        repo as unknown as Repository<User>,
        dataSource,
        capturing,
      );
    });

    const only = () => {
      expect(invocations).toHaveLength(1);
      return invocations[0];
    };

    it('fund(issue_id: u64, sponsor: Address, token: Address, amount: i128, deadline: u64)', async () => {
      await service.fund({
        amount: '25.5',
        asset: AssetType.USDC,
        funderAddress: ADDRESS_A,
        bountyId: escrow.id,
        onChainIssueId: '987654321',
      });

      const { method, args } = only();
      expect(method).toBe('fund');
      expect(args.map(typeOf)).toEqual([
        'scvU64',
        'scvAddress',
        'scvAddress',
        'scvI128',
        'scvU64',
      ]);
      expect(args[0].u64().toBigInt()).toBe(987654321n);
    });

    it('release(issue_id: u64, recipients: Vec<(Address, u32)>) for a single recipient', async () => {
      await service.release(escrow.id, ADDRESS_A);

      const { method, args } = only();
      expect(method).toBe('release');
      expect(args.map(typeOf)).toEqual(['scvU64', 'scvVec']);
      expect(args[0].u64().toBigInt()).toBe(123456789n);

      const recipients = args[1].vec()!;
      expect(recipients).toHaveLength(1);
      expect(pairTypes(recipients[0])).toEqual(['scvAddress', 'scvU32']);
      expect(recipients[0].vec()![1].u32()).toBe(10_000);
    });

    it('release(issue_id: u64, recipients: Vec<(Address, u32)>) for a team split', async () => {
      await service.splitRelease(escrow.id, [
        { recipientAddress: ADDRESS_A, percentage: 50 },
        { recipientAddress: ADDRESS_B, percentage: 30 },
        { recipientAddress: ADDRESS_C, percentage: 20 },
      ]);

      const { method, args } = only();
      expect(method).toBe('release');
      expect(args.map(typeOf)).toEqual(['scvU64', 'scvVec']);

      const recipients = args[1].vec()!;
      expect(recipients).toHaveLength(3);
      for (const pair of recipients) {
        expect(typeOf(pair)).toBe('scvVec');
        expect(pairTypes(pair)).toEqual(['scvAddress', 'scvU32']);
      }
      expect(recipients.map((p) => p.vec()![1].u32())).toEqual([
        5000, 3000, 2000,
      ]);
    });

    it('refund(issue_id: u64)', async () => {
      await service.refund(escrow.id);

      const { method, args } = only();
      expect(method).toBe('refund');
      expect(args.map(typeOf)).toEqual(['scvU64']);
      expect(args[0].u64().toBigInt()).toBe(123456789n);
    });

    // The two cases below pin known, separately filed encoding bugs (#840).
    // `it.failing` keeps the suite green while they are open and turns red
    // the moment a fix lands — at which point drop `.failing`.

    // poolWithdraw sends the pool key as a bare bigint, which encodes as
    // i128 rather than the u64 the contract expects.
    it.failing(
      'withdraw(pool_id: u64, recipient: Address, amount: i128)',
      async () => {
        escrow.maintenancePoolId = '5f2d8a1e-3b4c-4d5e-8f6a-7b8c9d0e1f2a';
        await service.poolWithdraw(escrow.id, '10', ADDRESS_A);

        const { method, args } = only();
        expect(method).toBe('withdraw');
        expect(args.map(typeOf)).toEqual(['scvU64', 'scvAddress', 'scvI128']);
      },
    );

    // releasePartial sends the milestone/bounty UUID string as its first
    // argument, which encodes as scvString where a u64 is expected.
    it.failing(
      'release_partial(id: u64, recipient: Address, amount: i128)',
      async () => {
        escrow.milestoneId = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
        await service.releasePartial(escrow.id, '10', ADDRESS_A);

        const { method, args } = only();
        expect(method).toBe('release_partial');
        expect(args.map(typeOf)).toEqual(['scvU64', 'scvAddress', 'scvI128']);
      },
    );
  });
});
