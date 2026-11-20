import { Logger } from '@nestjs/common';
import { ValueTransformer } from 'typeorm';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

/** Used only outside production when ENCRYPTION_KEY is unset. */
const DEV_FALLBACK_KEY =
  '64a2f98b7e3c1d5e6f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e';

const logger = new Logger('EncryptionTransformer');

let cachedKey: Buffer | null = null;

/**
 * The 32-byte AES key, validated on first use. A bad or missing key throws
 * here rather than letting values be written unencrypted (#783).
 */
function encryptionKey(): Buffer {
  if (cachedKey) return cachedKey;
  const configured = process.env.ENCRYPTION_KEY;
  if (!configured && process.env.NODE_ENV === 'production') {
    throw new Error('ENCRYPTION_KEY must be set in production');
  }
  const hex = configured || DEV_FALLBACK_KEY;
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error('ENCRYPTION_KEY must be 64 hex characters (32 bytes)');
  }
  cachedKey = Buffer.from(hex, 'hex');
  return cachedKey;
}

export class EncryptionTransformer implements ValueTransformer {
  /** Encrypts on write. Any failure throws, so a secret is never stored in plaintext. */
  to(value: string | null): string | null {
    if (!value) return null;
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
    let encrypted = cipher.update(value, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    return `${iv.toString('hex')}:${authTag}:${encrypted}`;
  }

  /** Decrypts on read. A value that does not decrypt throws instead of being returned raw. */
  from(value: string | null): string | null {
    if (!value) return null;
    const parts = value.split(':');
    if (parts.length !== 3 || parts.some((part) => part.length === 0)) {
      // Rows written before encryption was enforced hold plaintext. Return
      // them unchanged, but log it so the rows can be found and re-encrypted.
      logger.warn('Encrypted column holds a value not in iv:tag:ciphertext form');
      return value;
    }
    const [ivHex, authTagHex, encryptedDataHex] = parts;
    try {
      const decipher = createDecipheriv(
        'aes-256-gcm',
        encryptionKey(),
        Buffer.from(ivHex, 'hex'),
      );
      decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
      let decrypted = decipher.update(encryptedDataHex, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      return decrypted;
    } catch (err) {
      logger.error('Failed to decrypt column value; check ENCRYPTION_KEY and key rotation');
      throw err;
    }
  }
}
