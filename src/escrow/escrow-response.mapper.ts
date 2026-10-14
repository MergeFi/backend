import { Escrow, Payment } from '../common/entities';

export type PublicEscrow = Omit<Escrow, 'metadata'>;

/** A Payment with its `escrow` relation redacted to the public shape. */
export type PublicPayment = Omit<Payment, 'escrow'> & {
  escrow?: PublicEscrow;
};

/**
 * Strips `metadata` before an Escrow reaches an HTTP client. `metadata`
 * intentionally stores raw diagnostic detail from Soroban RPC calls —
 * including, on a failed `fund`, the raw error message
 * (`EscrowService.fund`'s catch block) — which is exactly the class of
 * internal detail #19 is about keeping server-side only (useful here for
 * debugging via direct DB access, never via the API response).
 *
 * Deliberately applied at the controller boundary, not inside
 * `EscrowService`: other services (`BountiesService`, `MilestonesService`)
 * consume the full `Escrow` entity returned by `EscrowService.fund`
 * internally and shouldn't have to work around a narrowed return type.
 */
export function toPublicEscrow(escrow: Escrow): PublicEscrow {
  const publicEscrow: Partial<Escrow> = { ...escrow };
  delete publicEscrow.metadata;
  return publicEscrow as PublicEscrow;
}

/**
 * #91 — `splitRelease` returned raw `Payment[]`, so a loaded `payment.escrow`
 * relation carried `Escrow.metadata` (raw Soroban diagnostics) to the client.
 * Strip it the same way `toPublicEscrow` does for the escrow routes.
 */
export function toPublicPayment(payment: Payment): PublicPayment {
  const { escrow, ...rest } = payment;
  return escrow ? { ...rest, escrow: toPublicEscrow(escrow) } : { ...rest };
}
