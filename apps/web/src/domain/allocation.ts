/**
 * Which instalment each confirmed payment paid off, so receipts can be shown
 * under the instalment they belong to.
 *
 * Mirrors private.replay_payments (ADR-0010): confirmed payments in the order
 * they were received fill instalments oldest first. One payment can be split
 * across instalments, and the last can be part-paid.
 */
import { toCents, type Cents } from './money'

export interface AllocatablePayment {
  id: string
  amountCents: Cents
  receivedOn: string
  createdAt: string
}

export interface Allocation<P extends AllocatablePayment> {
  payment: P
  /** How much of this payment went to this instalment. */
  appliedCents: Cents
}

/**
 * Returns, for each instalment sequence, the payments that went towards it.
 * Money beyond the last instalment (shouldn't happen; the database blocks
 * overpayment) is attached to the last instalment.
 */
export function allocatePayments<P extends AllocatablePayment>(
  instalments: readonly { sequence: number; amountCents: Cents }[],
  confirmedPayments: readonly P[],
): Map<number, Allocation<P>[]> {
  const ordered = [...instalments].sort((a, b) => a.sequence - b.sequence)
  const result = new Map<number, Allocation<P>[]>(ordered.map((i) => [i.sequence, []]))
  const payments = [...confirmedPayments].sort(
    (a, b) =>
      a.receivedOn.localeCompare(b.receivedOn) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  )

  let index = 0
  let roomLeft: number = ordered[0]?.amountCents ?? 0
  for (const payment of payments) {
    let left: number = payment.amountCents
    while (left > 0) {
      const instalment = ordered[index]
      if (!instalment) break
      const isLast = index === ordered.length - 1
      const applied = isLast ? left : Math.min(left, roomLeft)
      if (applied > 0) result.get(instalment.sequence)?.push({ payment, appliedCents: toCents(applied) })
      left -= applied
      roomLeft -= applied
      if (roomLeft <= 0 && !isLast) {
        index += 1
        roomLeft = ordered[index]?.amountCents ?? 0
      }
    }
  }
  return result
}
