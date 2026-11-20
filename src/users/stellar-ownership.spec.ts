import { createHash, generateKeyPairSync, sign } from 'crypto';
import { StrKey } from '@stellar/stellar-sdk';
import {
  buildStellarOwnershipMessage,
  stellarSignedMessageDigest,
  verifyStellarOwnershipSignature,
} from './stellar-ownership';

describe('stellar-ownership (#791)', () => {
  function makeWallet() {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const raw = Buffer.from(
      (publicKey.export({ format: 'jwk' }) as { x: string }).x,
      'base64url',
    );
    return {
      address: StrKey.encodeEd25519PublicKey(raw),
      signBase64: (message: string) =>
        sign(
          null,
          createHash('sha256')
            .update('Stellar Signed Message:\n' + message, 'utf8')
            .digest(),
          privateKey,
        ).toString('base64'),
    };
  }

  const message = 'app.mergefi.test wants you to prove you control this address.';

  it('accepts a SEP-53 signature made by the claimed address key', () => {
    const wallet = makeWallet();
    expect(
      verifyStellarOwnershipSignature(wallet.address, message, wallet.signBase64(message)),
    ).toBe(true);
  });

  it('rejects a signature over a different message', () => {
    const wallet = makeWallet();
    expect(
      verifyStellarOwnershipSignature(
        wallet.address,
        'another message',
        wallet.signBase64(message),
      ),
    ).toBe(false);
  });

  it('rejects a signature by another key', () => {
    const owner = makeWallet();
    const other = makeWallet();
    expect(
      verifyStellarOwnershipSignature(owner.address, message, other.signBase64(message)),
    ).toBe(false);
  });

  it('rejects a signature that was not prefixed per SEP-53', () => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const raw = Buffer.from(
      (publicKey.export({ format: 'jwk' }) as { x: string }).x,
      'base64url',
    );
    const address = StrKey.encodeEd25519PublicKey(raw);
    const unprefixed = sign(
      null,
      createHash('sha256').update(message, 'utf8').digest(),
      privateKey,
    ).toString('base64');
    expect(verifyStellarOwnershipSignature(address, message, unprefixed)).toBe(false);
  });

  it.each([
    ['empty', ''],
    ['wrong length', Buffer.alloc(10).toString('base64')],
    ['garbage', '!!!not-base64!!!'],
  ])('returns false for a %s signature instead of throwing', (_label, sig) => {
    const wallet = makeWallet();
    expect(verifyStellarOwnershipSignature(wallet.address, message, sig)).toBe(false);
  });

  it('returns false when the address is not a valid Stellar public key', () => {
    const wallet = makeWallet();
    expect(
      verifyStellarOwnershipSignature('GNOTAVALIDADDRESS', message, wallet.signBase64(message)),
    ).toBe(false);
  });

  it('digest is sha256 over the SEP-53 prefix plus message', () => {
    expect(stellarSignedMessageDigest('hi')).toEqual(
      createHash('sha256').update('Stellar Signed Message:\nhi', 'utf8').digest(),
    );
  });

  it('builds a message containing the domain, address, user, nonce and expiry', () => {
    const issuedAt = new Date('2026-01-01T00:00:00.000Z');
    const expiresAt = new Date('2026-01-01T00:05:00.000Z');
    const text = buildStellarOwnershipMessage({
      domain: 'app.mergefi.test',
      userId: 'u1',
      stellarAddress: 'GADDR',
      nonce: 'NONCE',
      issuedAt,
      expiresAt,
    });
    expect(text).toBe(
      [
        'app.mergefi.test wants you to prove you control this Stellar address.',
        '',
        'Address: GADDR',
        'User ID: u1',
        'Nonce: NONCE',
        'Issued At: 2026-01-01T00:00:00.000Z',
        'Expires At: 2026-01-01T00:05:00.000Z',
      ].join('\n'),
    );
  });
});
