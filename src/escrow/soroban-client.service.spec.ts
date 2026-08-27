import { ConfigService } from '@nestjs/config';
import { nativeToScVal, rpc } from '@stellar/stellar-sdk';
import { AssetType } from '../common/enums';
import { AppConfig } from '../config/configuration';
import { SorobanClientService } from './soroban-client.service';

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
};

function makeService(
  overrides: Partial<StellarConfig> = {},
): SorobanClientService {
  const configService = {
    get: jest.fn(() => ({ ...baseStellarConfig, ...overrides })),
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
      expect(makeService({ escrowContractId: 'CESCROW' }).escrowContractId).toBe(
        'CESCROW',
      );
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
    it('returns a deterministic dry-run result without touching the RPC server when unconfigured', async () => {
      const sendSpy = jest.spyOn(rpc.Server.prototype, 'sendTransaction');
      const getTxSpy = jest.spyOn(rpc.Server.prototype, 'getTransaction');

      const result = await makeService().invoke('release', ['ref-1']);

      expect(result.status).toBe('DRY_RUN');
      expect(result.txHash).toMatch(/^dry-run-release-/);
      expect(result.ledger).toBeNull();
      expect(result.returnValue).toBeNull();
      expect(sendSpy).not.toHaveBeenCalled();
      expect(getTxSpy).not.toHaveBeenCalled();
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
      jest
        .spyOn(rpc.Server.prototype, 'sendTransaction')
        .mockResolvedValue({
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
      jest
        .spyOn(rpc.Server.prototype, 'sendTransaction')
        .mockResolvedValue({
          status: 'ERROR',
          errorResult: { code: -1 },
        } as never);

      await expect(service.invoke('refund', ['ref-1'])).rejects.toThrow(
        'Soroban transaction submission failed',
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
      jest
        .spyOn(rpc.Server.prototype, 'sendTransaction')
        .mockResolvedValue({
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

    it('times out after exhausting all attempts when the transaction stays NOT_FOUND', async () => {
      const getTxSpy = jest
        .spyOn(rpc.Server.prototype, 'getTransaction')
        .mockResolvedValue(txResponse({ status: 'NOT_FOUND' }));

      const settled = service.invoke('refund', ['ref-1']).then(
        () => null,
        (err: Error) => err,
      );
      await jest.advanceTimersByTimeAsync(21_000);
      const err = await settled;

      expect(getTxSpy).toHaveBeenCalledTimes(10);
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toContain(
        'Timed out waiting for Soroban transaction mock-hash to finalize',
      );
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
      const a =
        'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAVAWHV';
      const b =
        'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBAAAA';

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
