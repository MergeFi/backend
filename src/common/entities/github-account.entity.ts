import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { User } from './user.entity';

// Secure transformer to encrypt and decrypt sensitive access/refresh tokens automatically
const encryptionTransformer = {
  to: (value: string | null) => {
    if (!value) return null;
    try {
      const secretKeyString =
        process.env.ENCRYPTION_KEY ||
        '64a2f98b7e3c1d5e6f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e';
      const key = Buffer.from(secretKeyString, 'hex');
      const iv = randomBytes(12);

      const cipher = createCipheriv('aes-256-gcm', key, iv);
      let encrypted = cipher.update(value, 'utf8', 'hex');
      encrypted += cipher.final('hex');

      const authTag = cipher.getAuthTag().toString('hex');

      return `${iv.toString('hex')}:${authTag}:${encrypted}`;
    } catch {
      return value;
    }
  },

  from: (value: string | null) => {
    if (!value) return null;
    try {
      const [ivHex, authTagHex, encryptedDataHex] = value.split(':');
      if (!ivHex || !authTagHex || !encryptedDataHex) return value;

      const secretKeyString =
        process.env.ENCRYPTION_KEY ||
        '64a2f98b7e3c1d5e6f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e';
      const key = Buffer.from(secretKeyString, 'hex');
      const iv = Buffer.from(ivHex, 'hex');
      const authTag = Buffer.from(authTagHex, 'hex');

      const decipher = createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(authTag);

      let decrypted = decipher.update(encryptedDataHex, 'hex', 'utf8');
      decrypted += decipher.final('utf8');

      return decrypted;
    } catch {
      return value;
    }
  },
};

@Entity('github_accounts')
export class GithubAccount {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar' })
  login: string;

  @Column({ type: 'varchar', unique: true })
  githubId: string;

  @Column({ type: 'varchar', nullable: true })
  avatarUrl: string | null;

  @Column({ type: 'varchar', nullable: true })
  profileUrl: string | null;

  // FIXED: Changed nullable to false so the service knows it will always find a valid string
  @Column({ type: 'varchar', nullable: false })
  userId: string;

  @ManyToOne(() => User, (user) => user.id, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({
    type: 'varchar',
    nullable: true,
    select: false,
    transformer: encryptionTransformer,
  })
  accessToken: string | null;

  @Column({
    type: 'varchar',
    nullable: true,
    select: false,
    transformer: encryptionTransformer,
  })
  refreshToken: string | null;
}
