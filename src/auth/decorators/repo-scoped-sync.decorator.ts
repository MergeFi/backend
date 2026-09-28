import { SetMetadata } from '@nestjs/common';

/** Metadata key read by RepoScopeGuard. */
export const REPO_SCOPED_SYNC_KEY = 'repo_scoped_sync';

/**
 * Marks a route as needing per-repository authorization in addition to
 * `@Roles(...)`: the caller must be the repository's recorded maintainer, or —
 * for a repository not yet tracked — be on the first-time sync allowlist (#312).
 */
export const RepoScopedSync = () => SetMetadata(REPO_SCOPED_SYNC_KEY, true);
