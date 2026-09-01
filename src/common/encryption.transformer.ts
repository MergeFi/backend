import { ValueTransformer } from 'typeorm';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

export class EncryptionTransformer implements ValueTransformer {
  to(value: string | null): string | null {
    if (!value) return null;
    try {
      const secretKeyString = process.env.ENCRYPTION_KEY || '64a2f98b7e3c1d5e6f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e';
      const key = Buffer.from(secretKeyString, 'hex');
      const iv = randomBytes(12);
      
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      let encrypted = cipher.update(value, 'utf8', 'hex');
      encrypted += cipher.final('hex');
      
      const authTag = cipher.getAuthTag().toString('hex');
      
      return `${iv.toString('hex')}:${authTag}:${encrypted}`;
    } catch (error) {
      return value;
    }
  }

  from(value: string | null): string | null {
    if (!value) return null;
    try {
      const [ivHex, authTagHex, encryptedDataHex] = value.split(':');
      if (!ivHex || !authTagHex || !encryptedDataHex) return value;

      const secretKeyString = process.env.ENCRYPTION_KEY || '64a2f98b7e3c1d5e6f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e';
      const key = Buffer.from(secretKeyString, 'hex');
      const iv = Buffer.from(ivHex, 'hex');
      const authTag = Buffer.from(authTagHex, 'hex');
      
      const decipher = createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(authTag);
      
      let decrypted = decipher.update(encryptedDataHex, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      
      return decrypted;
    } catch (error) {
      return value;
    }
  }
}
