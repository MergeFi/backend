export enum UserRole {
  CONTRIBUTOR = 'contributor',
  MAINTAINER = 'maintainer',
  SPONSOR = 'sponsor',
}

/**
 * Lifecycle of a paid issue (bounty).
 *
 * open        -> funds not yet locked, issue published as paid
 * funded      -> sponsor funded the escrow contract for this bounty
 * claimed     -> a contributor was assigned / claimed the work
 * in_review   -> a PR has been opened against the linked issue
 * merged      -> the linked PR was merged on GitHub
 * paid        -> escrow release succeeded, contributor(s) paid
 * refunded    -> escrow refunded back to sponsor (e.g. abandoned)
 * expired     -> deadline passed with no claim/merge
 */
export enum BountyStatus {
  OPEN = 'open',
  FUNDED = 'funded',
  CLAIMED = 'claimed',
  IN_REVIEW = 'in_review',
  MERGED = 'merged',
  PAID = 'paid',
  REFUNDED = 'refunded',
  EXPIRED = 'expired',
}

export enum BountyDifficulty {
  BEGINNER = 'beginner',
  INTERMEDIATE = 'intermediate',
  ADVANCED = 'advanced',
  EXPERT = 'expert',
}

export enum AssetType {
  USDC = 'USDC',
  XLM = 'XLM',
}

export enum EscrowStatus {
  PENDING = 'pending',
  LOCKED = 'locked',
  RELEASED = 'released',
  REFUNDED = 'refunded',
  FAILED = 'failed',
}

export enum EscrowAction {
  FUND = 'fund',
  RELEASE = 'release',
  REFUND = 'refund',
  SPLIT_RELEASE = 'split_release',
}

export enum PaymentStatus {
  PENDING = 'pending',
  SUBMITTED = 'submitted',
  CONFIRMED = 'confirmed',
  FAILED = 'failed',
}

export enum MilestoneStatus {
  OPEN = 'open',
  FUNDED = 'funded',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  CLOSED = 'closed',
}

export enum MaintenancePoolStatus {
  ACTIVE = 'active',
  PAUSED = 'paused',
  CLOSED = 'closed',
}

export enum WebhookEventStatus {
  RECEIVED = 'received',
  PROCESSED = 'processed',
  IGNORED = 'ignored',
  FAILED = 'failed',
}

/**
 * processing -> a request with this key is currently executing; a second
 *               request with the same key while still processing is
 *               rejected (409) rather than racing into a duplicate
 *               execution.
 * completed  -> the underlying mutation ran to completion (success or a
 *               deterministic 4xx client error) and its outcome is cached;
 *               a repeat request with the same key replays it verbatim
 *               instead of re-executing.
 */
export enum IdempotencyKeyStatus {
  PROCESSING = 'processing',
  COMPLETED = 'completed',
}
