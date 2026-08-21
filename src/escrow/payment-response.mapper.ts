import { Payment } from '../common/entities';

export type PublicPayment = Payment;

/**
 * Thin passthrough today — Payment doesn't carry anything as sensitive as
 * Escrow.metadata yet. Exists so splitRelease follows the same
 * controller-boundary mapping pattern as every other escrow endpoint
 * (see toPublicEscrow), so a future internal-only field added to Payment
 * has somewhere to be stripped instead of leaking by default.
 */
export function toPublicPayment(payment: Payment): PublicPayment {
  return payment;
}

export function toPublicPayments(payments: Payment[]): PublicPayment[] {
  return payments.map(toPublicPayment);
}
