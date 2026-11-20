/**
 * Postgres advisory lock ids for the `@Cron` sweeps (#786).
 *
 * Every replica fires the same cron, so each sweep takes its lock under one
 * of these ids to run on a single instance. Keep the ids unique across the
 * codebase: two sweeps sharing an id would serialize against each other.
 */
export const ADVISORY_LOCK_IDS = {
  BOUNTY_EXPIRY: 847291,
  IDEMPOTENCY_CLEANUP: 847292,
} as const;
