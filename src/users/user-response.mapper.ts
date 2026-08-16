import { User } from '../common/entities';
import { UserRole } from '../common/enums';

export interface PublicGithubAccount {
  id: string;
  githubId: string;
  login: string;
  profileUrl: string | null;
  avatarUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PublicUser {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  roles: UserRole[];
  stellarAddress: string | null;
  email?: string | null;
  githubAccount?: PublicGithubAccount | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserSerializationOptions {
  /**
   * The authenticated user performing the request (if any).
   */
  currentUser?: {
    userId?: string;
    roles?: (UserRole | string)[];
  } | null;
}

/**
 * Maps a User entity into a public-safe HTTP response DTO.
 * Strips sensitive PII (`email`) unless the request caller is the user themselves
 * or has an admin/maintainer role (or 'admin' role string), mirroring the pattern established in `toPublicEscrow`.
 */
export function toPublicUser(
  user: User,
  options?: UserSerializationOptions,
): PublicUser {
  const isOwner = options?.currentUser?.userId === user.id;
  const isAdmin =
    options?.currentUser?.roles?.includes('admin') ||
    options?.currentUser?.roles?.includes(UserRole.MAINTAINER) ||
    false;
  const canViewEmail = isOwner || isAdmin;

  const publicGithubAccount: PublicGithubAccount | null = user.githubAccount
    ? {
        id: user.githubAccount.id,
        githubId: user.githubAccount.githubId,
        login: user.githubAccount.login,
        profileUrl: user.githubAccount.profileUrl,
        avatarUrl: user.githubAccount.avatarUrl,
        createdAt: user.githubAccount.createdAt,
        updatedAt: user.githubAccount.updatedAt,
      }
    : null;

  const publicUser: PublicUser = {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    roles: user.roles,
    stellarAddress: user.stellarAddress,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    ...(user.githubAccount !== undefined ? { githubAccount: publicGithubAccount } : {}),
  };

  if (canViewEmail) {
    publicUser.email = user.email;
  }

  return publicUser;
}
