import { Escrow } from '../common/entities';
import { AssetType, EscrowStatus } from '../common/enums';
import { toPublicEscrow, toPublicPayment } from './escrow-response.mapper';

function makeEscrow(overrides: Partial<Escrow> = {}): Escrow {
  return {
    id: 'esc_1',
    bounty: null,
    bountyId: 'bounty_1',
    milestone: null,
    milestoneId: null,
    maintenancePool: null,
    maintenancePoolId: null,
    sponsorId: 'sponsor_1',
    contractId: null,
    onChainId: null,
    deadline: null,
    amount: '100.0000000',
    asset: AssetType.USDC,
    status: EscrowStatus.FAILED,
    fundedByAddress: 'GFUNDER',
    fundTxHash: null,
    releaseTxHash: null,
    refundTxHash: null,
    metadata: {
      error:
        'Soroban simulation failed: HostError: Error(Contract, #1), account GABC...SECRET keypair mismatch',
    },
    payments: [],
    lockedAt: null,
    releasedAt: null,
    refundedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('toPublicEscrow', () => {
  it('strips metadata from the returned object', () => {
    const escrow = makeEscrow();

    const publicEscrow = toPublicEscrow(escrow);

    expect(publicEscrow).not.toHaveProperty('metadata');
    expect(JSON.stringify(publicEscrow)).not.toContain('SECRET');
    expect(JSON.stringify(publicEscrow)).not.toContain('HostError');
  });

  it('preserves every other field unchanged', () => {
    const escrow = makeEscrow();

    const publicEscrow = toPublicEscrow(escrow);

    expect(publicEscrow).toMatchObject({
      id: 'esc_1',
      bountyId: 'bounty_1',
      sponsorId: 'sponsor_1',
      amount: '100.0000000',
      status: EscrowStatus.FAILED,
      fundedByAddress: 'GFUNDER',
    });
  });

  it('strips metadata even when it contains successful Soroban result data', () => {
    const escrow = makeEscrow({
      status: EscrowStatus.LOCKED,
      metadata: {
        fund: {
          txHash: 'abc',
          ledger: 42,
          returnValue: null,
          status: 'SUCCESS',
        },
      },
    });

    const publicEscrow = toPublicEscrow(escrow);

    expect(publicEscrow).not.toHaveProperty('metadata');
  });
});

describe('toPublicPayment (#368)', () => {
  it('shapes Payment entity and strips nested relational objects', () => {
    const payment = {
      id: 'pay-1',
      escrowId: 'escrow-1',
      recipientId: 'user-1',
      recipientAddress: 'GADDR1',
      amount: '50.0000000',
      asset: AssetType.USDC,
      splitPercentage: '50.00',
      status: 'confirmed' as any,
      txHash: 'tx-1',
      createdAt: new Date(),
      updatedAt: new Date(),
      escrow: { id: 'escrow-1', metadata: { secret: 'leak' } } as any,
      recipient: { id: 'user-1', email: 'secret@email.com' } as any,
    };

    const publicPayment = toPublicPayment(payment as any);

    expect(publicPayment).not.toHaveProperty('escrow');
    expect(publicPayment).not.toHaveProperty('recipient');
    expect(publicPayment.id).toBe('pay-1');
    expect(publicPayment.amount).toBe('50.0000000');
    expect(publicPayment.recipientAddress).toBe('GADDR1');
  });
});
