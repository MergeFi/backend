import { ConfigService } from '@nestjs/config';
import { nativeToScVal, rpc } from '@stellar/stellar-sdk';
import { AssetType } from '../common/enums';
import { AppConfig } from '../config/configuration';
import {
  SOROBAN_TX_TIMEOUT_SECONDS,
  SorobanClientService,
  SorobanPendingError,
  u64,
} from './soroban-client.service';

jest.mock('@stellar/stellar-sdk', () => ({
  ...jest.requireActual('@stellar/stellar-sdk'),
  nativeToScVal: jest.fn((value: unknown) => value),
}));

type StellarConfig = AppConfig['stellar'];

const baseStellarConfig: StellarConfig = {
  network: 'testnet',
  sorobanRpcUrl: 'http://localhost:8000/rpc',
  networkPassphrase: 'Test SDF Network ; September 2015',
  escrowContractId: '',
  maintenancePoolContractId: '',
  treasurySecret: '',
  assetContractIds: { USDC: '', XLM: '' },
  escrowDeadlineSeconds: 7776000,
  dryRun: false,
  inclusionFee: 5000,
  protocolFeeBps: 250,
};

function makeService(
  overrides: Partial<StellarConfig> = {},
  env = 'test',
): SorobanClientService {
  const configService = {
    get: jest.fn((key: keyof AppConfig) =>
      key === 'env' ? env : { ...baseStellarConfig, ...overrides },
    ),
  };
  return new SorobanClientService(
    configService as unknown as ConfigService<AppConfig, true>,
  );
}

const txResponse = (overrides: Record<string, unknown>) =>
  overrides as unknown as rpc.Api.GetTransactionResponse;

const nativeToScValMock = nativeToScVal as unknown as jest.Mock;

describe('SorobanClientService', () => {
  beforeEach(() => {
    nativeToScValMock.mockClear();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('isConfigured', () => {
    it('is false when no contract ID and no treasury secret are set', () => {
      expect(makeService().isConfigured()).toBe(false);
    });

    it('is false when only the contract ID is set', () => {
      expect(
        makeService({ escrowContractId: 'CCONTRACT' }).isConfigured(),
      ).toBe(false);
    });

    it('is false when only the treasury secret is set', () => {
      expect(makeService({ treasurySecret: 'SSECRET' }).isConfigured()).toBe(
        false,
      );
    });

    it('is true once both contract ID and treasury secret are set', () => {
      expect(
        makeService({
          escrowContractId: 'CCONTRACT',
          treasurySecret: 'SSECRET',
        }).isConfigured(),
      ).toBe(true);
    });
  });

  describe('contract resolvers (#157)', () => {
    it('exposes the configured escrow contract id', () => {
      expect(
        makeService({ escrowContractId: 'CESCROW' }).escrowContractId,
      ).toBe('CESCROW');
    });

    it('returns the dedicated maintenance-pool contract id when set', () => {
      expect(
        makeService({
          escrowContractId: 'CESCROW',
          maintenancePoolContractId: 'CPOOL',
        }).maintenancePoolContractId,
      ).toBe('CPOOL');
    });

    it('falls back to the escrow contract id when no pool deployment is configured', () => {
      expect(
        makeService({ escrowContractId: 'CESCROW' }).maintenancePoolContractId,
      ).toBe('CESCROW');
    });

    it('resolves per-asset token contract ids and the deadline window', () => {
      const service = makeService({
        assetContractIds: { USDC: 'CUSDC', XLM: 'CXLM' },
        escrowDeadlineSeconds: 1234,
      });
      expect(service.tokenContractId(AssetType.USDC)).toBe('CUSDC');
      expect(service.tokenContractId(AssetType.XLM)).toBe('CXLM');
      expect(service.escrowDeadlineSeconds).toBe(1234);
    });
  });

  describe('invoke (dry-run gating)', () => {
    const unconfigured: [string, Partial<StellarConfig>][] = [
      ['neither variable is set', {}],
      ['only ESCROW_CONTRACT_ID is set', { escrowContractId: 'CCONTRACT' }],
      ['only TREASURY_SECRET is set', { treasurySecret: 'SSECRET' }],
    ];

    let rpcSpies: jest.SpyInstance[];

    beforeEach(() => {
      rpcSpies = [
        'getAccount',
        'simulateTransaction',
        'sendTransaction',
        'getTransaction',
      ].map((method) =>
        jest.spyOn(
          rpc.Server.prototype,
          method as keyof typeof rpc.Server.prototype,
        ),
      );
    });

    it('dry-runs without RPC only when explicitly enabled', async () => {
      const service = makeService({ dryRun: true });

      const result = await service.invoke('release', ['ref-1']);

      expect(result).toEqual({
        txHash: expect.stringMatching(/^dry-run-release-\d+$/),
        ledger: null,
        returnValue: null,
        status: 'DRY_RUN',
      });
      for (const spy of rpcSpies) expect(spy).not.toHaveBeenCalled();
    });

    it.each(unconfigured)(
      'rejects missing live configuration when dry-run is not enabled (%s)',
      async (_label, overrides) => {
        const service = makeService(overrides);

        await expect(service.invoke('release', ['ref-1'])).rejects.toThrow(
          'Refusing to invoke "release" without Soroban configuration',
        );
        for (const spy of rpcSpies) expect(spy).not.toHaveBeenCalled();
      },
    );

    it('does not silently dry-run in production when the flag is unset', async () => {
      const service = makeService({}, 'production');

      await expect(service.invoke('release', ['ref-1'])).rejects.toThrow(
        'Refusing to invoke "release" without Soroban configuration',
      );
      for (const spy of rpcSpies) expect(spy).not.toHaveBeenCalled();
    });
  });

  describe('invoke (configured pipeline)', () => {
    let service: SorobanClientService;
    let assembleSpy: jest.SpyInstance;

    beforeEach(() => {
      service = makeService({
        escrowContractId: 'CCONTRACT1234567890',
        treasurySecret: 'SSECRET',
      });
      jest
        .spyOn(rpc.Server.prototype, 'getAccount')
        .mockResolvedValue({} as never);
      jest
        .spyOn(rpc.Server.prototype, 'simulateTransaction')
        .mockResolvedValue({} as never);
      jest.spyOn(rpc.Server.prototype, 'sendTransaction').mockResolvedValue({
        status: 'PENDING',
        hash: 'mock-hash',
      } as never);
      jest
        .spyOn(rpc.Server.prototype, 'getTransaction')
        .mockResolvedValue(
          txResponse({ status: 'SUCCESS', ledger: 42, returnValue: null }),
        );
      assembleSpy = jest.spyOn(rpc, 'assembleTransaction');
    });

    it('simulates, assembles, signs, submits, and polls to a finalized result', async () => {
      const result = await service.invoke('fund', ['GFUNDER', 'bounty-1']);

      expect(assembleSpy).toHaveBeenCalledTimes(1);
      expect(result).toEqual({
        txHash: 'mock-hash',
        ledger: 42,
        returnValue: null,
        status: 'SUCCESS',
      });
    });

    it('converts a non-null transaction return value via scValToNative', async () => {
      jest
        .spyOn(rpc.Server.prototype, 'getTransaction')
        .mockResolvedValue(
          txResponse({ status: 'SUCCESS', ledger: 7, returnValue: 'native' }),
        );

      const result = await service.invoke('release', ['ref-1']);

      expect(result.returnValue).toBe('native');
    });

    it('throws when simulation fails', async () => {
      const isSimulationErrorSpy = jest
        .spyOn(rpc.Api, 'isSimulationError')
        .mockReturnValue(true);
      jest
        .spyOn(rpc.Server.prototype, 'simulateTransaction')
        .mockResolvedValue({ error: 'bad args' } as never);

      await expect(service.invoke('refund', ['ref-1'])).rejects.toThrow(
        'Soroban simulation failed: bad args',
      );
      expect(isSimulationErrorSpy).toHaveBeenCalled();
    });

    it('throws when transaction submission errors', async () => {
      jest.spyOn(rpc.Server.prototype, 'sendTransaction').mockResolvedValue({
        status: 'ERROR',
        errorResult: { code: -1 },
      } as never);

      await expect(service.invoke('refund', ['ref-1'])).rejects.toThrow(
        'Soroban transaction submission failed',
      );
    });

    it('retries TRY_AGAIN_LATER before polling the accepted transaction', async () => {
      jest.useFakeTimers();
      const sendSpy = jest
        .spyOn(rpc.Server.prototype, 'sendTransaction')
        .mockResolvedValueOnce({ status: 'TRY_AGAIN_LATER' } as never)
        .mockResolvedValueOnce({
          status: 'PENDING',
          hash: 'accepted-hash',
        } as never);
      const pending = service.invoke('fund', ['ref-1']);

      await jest.advanceTimersByTimeAsync(1000);
      const result = await pending;

      expect(sendSpy).toHaveBeenCalledTimes(2);
      expect(result.txHash).toBe('accepted-hash');
      expect(rpc.Server.prototype.getTransaction).toHaveBeenCalled();
    });

    it('stops after bounded TRY_AGAIN_LATER retries without polling', async () => {
      jest.useFakeTimers();
      const sendSpy = jest
        .spyOn(rpc.Server.prototype, 'sendTransaction')
        .mockResolvedValue({ status: 'TRY_AGAIN_LATER' } as never);
      const settled = service.invoke('fund', ['ref-1']).catch((error: Error) =>
        error,
      );

      await jest.advanceTimersByTimeAsync(4000);
      const error = await settled;

      expect(sendSpy).toHaveBeenCalledTimes(4);
      expect(error.message).toContain(
        'TRY_AGAIN_LATER after 4 attempts',
      );
      expect(rpc.Server.prototype.getTransaction).not.toHaveBeenCalled();
    });

    it('polls the existing transaction after DUPLICATE', async () => {
      jest
        .spyOn(rpc.Server.prototype, 'sendTransaction')
        .mockResolvedValue({
          status: 'DUPLICATE',
          hash: 'duplicate-hash',
        } as never);

      const result = await service.invoke('release', ['ref-1']);

      expect(result.txHash).toBe('duplicate-hash');
      expect(rpc.Server.prototype.getTransaction).toHaveBeenCalledWith(
        'duplicate-hash',
      );
    });
  });

  // Read paths used by EscrowReconciliationService (#849).
  describe('getTransaction / read (#849)', () => {
    const configured = () =>
      makeService({
        escrowContractId: 'CCONTRACT1234567890',
        treasurySecret: 'SSECRET',
      });

    it('returns null without an RPC call when not configured', async () => {
      const spy = jest.spyOn(rpc.Server.prototype, 'getTransaction');
      const service = makeService();

      await expect(service.getTransaction('h')).resolves.toBeNull();
      await expect(service.read('get_escrow', [u64(1n)])).resolves.toBe(
        undefined,
      );
      expect(spy).not.toHaveBeenCalled();
    });

    it.each([
      ['SUCCESS', 'SUCCESS'],
      ['FAILED', 'FAILED'],
      ['NOT_FOUND', 'NOT_FOUND'],
    ])('maps a single %s lookup without polling', async (rpcStatus, status) => {
      const spy = jest
        .spyOn(rpc.Server.prototype, 'getTransaction')
        .mockResolvedValue(
          txResponse({ status: rpcStatus, ledger: 9, returnValue: null }),
        );

      const result = await configured().getTransaction('hash-1');

      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith('hash-1');
      expect(result?.status).toBe(status);
    });

    it('simulates a read-only call and never submits it', async () => {
      const service = configured();
      jest
        .spyOn(rpc.Server.prototype, 'getAccount')
        .mockResolvedValue({} as never);
      jest
        .spyOn(rpc.Server.prototype, 'simulateTransaction')
        .mockResolvedValue({ result: { retval: undefined } } as never);
      const send = jest.spyOn(rpc.Server.prototype, 'sendTransaction');

      await expect(service.read('get_escrow', [u64(1n)])).resolves.toBeNull();
      expect(send).not.toHaveBeenCalled();
    });

    it('decodes the simulated return value', async () => {
      const service = configured();
      jest
        .spyOn(rpc.Server.prototype, 'getAccount')
        .mockResolvedValue({} as never);
      jest
        .spyOn(rpc.Server.prototype, 'simulateTransaction')
        .mockResolvedValue({
          result: { retval: { status: ['Locked'] } },
        } as never);

      await expect(service.read('get_escrow', [u64(1n)])).resolves.toEqual({
        status: ['Locked'],
      });
    });

    it('throws when the read simulation fails', async () => {
      const service = configured();
      jest
        .spyOn(rpc.Server.prototype, 'getAccount')
        .mockResolvedValue({} as never);
      jest.spyOn(rpc.Api, 'isSimulationError').mockReturnValue(true);
      jest
        .spyOn(rpc.Server.prototype, 'simulateTransaction')
        .mockResolvedValue({ error: 'no such method' } as never);

      await expect(service.read('get_escrow', [u64(1n)])).rejects.toThrow(
        'Soroban simulation failed: no such method',
      );
    });
  });

  describe('pollTransaction (via invoke)', () => {
    let service: SorobanClientService;

    beforeEach(() => {
      service = makeService({
        escrowContractId: 'CCONTRACT1234567890',
        treasurySecret: 'SSECRET',
      });
      jest
        .spyOn(rpc.Server.prototype, 'getAccount')
        .mockResolvedValue({} as never);
      jest
        .spyOn(rpc.Server.prototype, 'simulateTransaction')
        .mockResolvedValue({} as never);
      jest.spyOn(rpc.Server.prototype, 'sendTransaction').mockResolvedValue({
        status: 'PENDING',
        hash: 'mock-hash',
      } as never);
      jest.useFakeTimers();
    });

    it('retries while the RPC reports NOT_FOUND and resolves once finalized', async () => {
      const getTxSpy = jest
        .spyOn(rpc.Server.prototype, 'getTransaction')
        .mockResolvedValueOnce(txResponse({ status: 'NOT_FOUND' }))
        .mockResolvedValueOnce(txResponse({ status: 'NOT_FOUND' }))
        .mockResolvedValue(
          txResponse({ status: 'SUCCESS', ledger: 9, returnValue: null }),
        );

      const pending = service.invoke('release', ['ref-1']);
      await jest.advanceTimersByTimeAsync(20_000);
      const result = await pending;

      expect(getTxSpy).toHaveBeenCalledTimes(3);
      expect(result.status).toBe('SUCCESS');
      expect(result.ledger).toBe(9);
    });

    it('polls for the full tx time bound, then throws SorobanPendingError (#527)', async () => {
      const getTxSpy = jest
        .spyOn(rpc.Server.prototype, 'getTransaction')
        .mockResolvedValue(txResponse({ status: 'NOT_FOUND' }));

      const settled = service.invoke('refund', ['ref-1']).then(
        () => null,
        (err: Error) => err,
      );
      await jest.advanceTimersByTimeAsync(
        SOROBAN_TX_TIMEOUT_SECONDS * 1000 + 5_000,
      );
      const err = await settled;

      // 60s time bound at 2s per poll, plus one final attempt past expiry.
      expect(getTxSpy).toHaveBeenCalledTimes(31);
      expect(err).toBeInstanceOf(SorobanPendingError);
      expect((err as SorobanPendingError).txHash).toBe('mock-hash');
      expect((err as Error).message).toContain(
        'Timed out waiting for Soroban transaction mock-hash to finalize',
      );
    });

    it('rebuilds an expired, never-included transaction at a higher fee', async () => {
      const getTxSpy = jest
        .spyOn(rpc.Server.prototype, 'getTransaction')
        .mockResolvedValueOnce(
          txResponse({ status: 'NOT_FOUND' }),
        );
      for (let i = 0; i < 30; i++) {
        getTxSpy.mockResolvedValueOnce(txResponse({ status: 'NOT_FOUND' }));
      }
      getTxSpy.mockResolvedValueOnce(
        txResponse({ status: 'SUCCESS', ledger: 10, returnValue: null }),
      );
      const assembleSpy = jest.spyOn(rpc, 'assembleTransaction');
      const pending = service.invoke('release', ['ref-1']);

      await jest.advanceTimersByTimeAsync(70_000);
      await pending;

      expect(assembleSpy).toHaveBeenCalledTimes(2);
      expect(rpc.Server.prototype.getAccount).toHaveBeenCalledTimes(2);
    });
  });

  describe('toScVal argument encoding (via private hook)', () => {
    let service: SorobanClientService;

    beforeEach(() => {
      service = makeService();
    });

    it('detects uppercase alphanumeric strings of >= 32 chars as Stellar addresses', () => {
      const address =
        'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVAWHV';

      const encoded = (
        service as unknown as { toScVal(v: unknown): unknown }
      ).toScVal(address);

      expect(encoded).toBe(address);
      expect(nativeToScValMock).not.toHaveBeenCalled();
    });

    it('encodes a Buffer as BytesN bytes (#45)', () => {
      const hash = Buffer.from('a'.repeat(32));

      const encoded = (
        service as unknown as { toScVal(v: unknown): unknown }
      ).toScVal(hash);

      expect(nativeToScValMock).toHaveBeenCalledWith(hash, { type: 'bytes' });
      expect(encoded).toEqual(hash);
    });

    it('encodes a Uint8Array as BytesN bytes (#45)', () => {
      const hash = new Uint8Array(32).fill(7);

      const encoded = (
        service as unknown as { toScVal(v: unknown): unknown }
      ).toScVal(hash);

      expect(nativeToScValMock).toHaveBeenCalledWith(Buffer.from(hash), {
        type: 'bytes',
      });
      expect(encoded).toEqual(Buffer.from(hash));
    });

    it('encodes bigints as i128', () => {
      const encoded = (
        service as unknown as { toScVal(v: unknown): unknown }
      ).toScVal(1_000_000n);

      expect(nativeToScValMock).toHaveBeenCalledWith(1_000_000n, {
        type: 'i128',
      });
      expect(encoded).toBe(1_000_000n);
    });

    it('encodes a u64-marked value as ScVal::U64 instead of i128 (#301)', () => {
      const encoded = (
        service as unknown as { toScVal(v: unknown): unknown }
      ).toScVal(u64(4242n));

      expect(nativeToScValMock).toHaveBeenCalledWith(4242n, { type: 'u64' });
      expect(encoded).toBe(4242n);
    });

    it('normalizes string/number u64 inputs through BigInt', () => {
      (service as unknown as { toScVal(v: unknown): unknown }).toScVal(
        u64('7007'),
      );
      expect(nativeToScValMock).toHaveBeenCalledWith(7007n, { type: 'u64' });

      nativeToScValMock.mockClear();
      (service as unknown as { toScVal(v: unknown): unknown }).toScVal(u64(42));
      expect(nativeToScValMock).toHaveBeenCalledWith(42n, { type: 'u64' });
    });

    it('still encodes a bare bigint amount as i128 (#301 — only u64 params are marked)', () => {
      (service as unknown as { toScVal(v: unknown): unknown }).toScVal(
        1_000_000n,
      );
      expect(nativeToScValMock).toHaveBeenCalledWith(1_000_000n, {
        type: 'i128',
      });
    });

    it('encodes short/plain strings with generic native encoding', () => {
      const encoded = (
        service as unknown as { toScVal(v: unknown): unknown }
      ).toScVal('bounty-1');

      expect(nativeToScValMock).toHaveBeenCalledWith('bounty-1');
      expect(encoded).toBe('bounty-1');
    });

    it('encodes numbers with generic native encoding', () => {
      const encoded = (
        service as unknown as { toScVal(v: unknown): unknown }
      ).toScVal(42);

      expect(nativeToScValMock).toHaveBeenCalledWith(42);
      expect(encoded).toBe(42);
    });

    it('encodes a [address, basisPoints] pair as an (Address, u32) tuple (#161)', () => {
      const address =
        'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVAWHV';

      const encoded = (
        service as unknown as { toScVal(v: unknown): unknown }
      ).toScVal([address, 5000]);

      expect(nativeToScValMock).toHaveBeenCalledWith(5000, { type: 'u32' });
      expect(encoded).toEqual([address, 5000]);
    });

    it('encodes a Vec<(Address, u32)> recipients list element-by-element (#161)', () => {
      const a = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVAWHV';
      const b = 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBAAAA';

      const encoded = (
        service as unknown as { toScVal(v: unknown): unknown }
      ).toScVal([
        [a, 6000],
        [b, 4000],
      ]);

      expect(encoded).toEqual([
        [a, 6000],
        [b, 4000],
      ]);
    });
  });
});
