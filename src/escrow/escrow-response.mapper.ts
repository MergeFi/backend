import { Escrow, Payment } from '../common/entities';

export type PublicEscrow = Omit<Escrow, 'metadata'>;

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

export type PublicPayment = Omit<Payment, 'escrow' | 'recipient'>;

/**
 * Shapes a `Payment` entity before returning it across the HTTP boundary (#91, #368).
 * Ensures internal relational entity graphs (e.g. attached `escrow` or full `recipient` User entity)
 * are excluded from the response payload, leaving only clean payment attributes.
 */
export function toPublicPayment(payment: Payment): PublicPayment {
  const publicPayment: Partial<Payment> = { ...payment };
  delete (publicPayment as Partial<Payment>).escrow;
  delete (publicPayment as Partial<Payment>).recipient;
  return publicPayment as PublicPayment;
}
