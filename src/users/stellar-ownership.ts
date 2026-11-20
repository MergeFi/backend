import { createHash } from 'crypto';
import { Keypair } from '@stellar/stellar-sdk';

/**
 * Proof-of-ownership helpers for linking a Stellar address (#791).
 *
 * The wallet signs with Freighter's signMessage, which follows SEP-53: the
 * signed bytes are sha256("Stellar Signed Message:\n" + message), signed with
 * the account's Ed25519 key. The signature comes back base64-encoded
 * (see signOwnershipMessage in MergeFi/frontend src/lib/wallet.ts).
 */
export const STELLAR_SIGNED_MESSAGE_PREFIX = 'Stellar Signed Message:\n';

/** How long an issued challenge stays redeemable. */
export const STELLAR_OWNERSHIP_CHALLENGE_TTL_MS = 5 * 60 * 1000;

export interface StellarOwnershipMessageParts {
  domain: string;
  userId: string;
  stellarAddress: string;
  nonce: string;
  issuedAt: Date;
  expiresAt: Date;
}

/** The exact text the server issues and the wallet signs. */
export function buildStellarOwnershipMessage(
  parts: StellarOwnershipMessageParts,
): string {
  return [
    `${parts.domain} wants you to prove you control this Stellar address.`,
    '',
    `Address: ${parts.stellarAddress}`,
    `User ID: ${parts.userId}`,
    `Nonce: ${parts.nonce}`,
    `Issued At: ${parts.issuedAt.toISOString()}`,
    `Expires At: ${parts.expiresAt.toISOString()}`,
  ].join('\n');
}

/** SEP-53 digest: sha256 over the prefixed message. */
export function stellarSignedMessageDigest(message: string): Buffer {
  return createHash('sha256')
    .update(STELLAR_SIGNED_MESSAGE_PREFIX + message, 'utf8')
    .digest();
}

/**
 * True only if `signatureBase64` is a valid Ed25519 signature by the key
 * encoded in `stellarAddress` over `message`. Malformed input returns false
 * rather than throwing, so callers map every failure to one rejection.
 */
export function verifyStellarOwnershipSignature(
  stellarAddress: string,
  message: string,
  signatureBase64: string,
): boolean {
  try {
    const signature = Buffer.from(signatureBase64, 'base64');
    if (signature.length !== 64) return false;
    return Keypair.fromPublicKey(stellarAddress).verify(
      stellarSignedMessageDigest(message),
      signature,
    );
  } catch {
    return false;
  }
}
