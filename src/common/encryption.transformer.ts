import { Logger } from '@nestjs/common';
import { ValueTransformer } from 'typeorm';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const logger = new Logger('EncryptionTransformer');

let cachedKey: Buffer | null = null;

/**
 * The 32-byte AES key, validated on first use. A bad or missing key throws
 * here rather than letting values be written unencrypted (#783).
 */
function encryptionKey(): Buffer {
  if (cachedKey) return cachedKey;
  // There is no default key. A key committed to the repository is public, so an unset key must fail
  // closed in every environment, not only in production (#782).
  const hex = process.env.ENCRYPTION_KEY;
  if (!hex) {
    throw new Error('ENCRYPTION_KEY must be set; there is no default encryption key');
  }
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
