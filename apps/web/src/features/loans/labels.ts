import type { LoanStatus, PaymentMethod } from '../../data/database.types'
import type { Role } from '../../data/loans'
import { formatCents } from '../../domain/money'
import { MAX_INSTALMENTS, type ScheduleProblem } from '../../domain/schedule'

/** Loans that are still in progress (not closed). */
export const OPEN_STATUSES: ReadonlySet<LoanStatus> = new Set<LoanStatus>(['negotiating', 'agreed', 'active'])

type Tone = 'neutral' | 'brand' | 'positive' | 'warning' | 'danger'

/** Short status for badges, worded from the viewer's point of view. */
export function statusBadge(status: LoanStatus, role: Role, awaitingMe: boolean): { label: string; tone: Tone } {
  switch (status) {
    case 'negotiating':
      return awaitingMe
        ? { label: 'Your reply needed', tone: 'warning' }
        : { label: 'Waiting for reply', tone: 'neutral' }
    case 'agreed':
      return role === 'lender'
        ? { label: 'Send the money', tone: 'warning' }
        : { label: 'Agreed, awaiting money', tone: 'brand' }
    case 'active':
      return { label: 'Active', tone: 'positive' }
    case 'completed':
      return { label: 'Repaid', tone: 'positive' }
    case 'rejected':
      return { label: 'Declined', tone: 'neutral' }
    case 'withdrawn':
      return { label: 'Cancelled', tone: 'neutral' }
    case 'written_off':
      return { label: 'Written off', tone: 'neutral' }
    case 'removed':
      return { label: 'Removed', tone: 'neutral' }
  }
}

export const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: 'bank_transfer', label: 'Bank transfer' },
  { value: 'cash', label: 'Cash' },
  { value: 'other', label: 'Other' },
]

export function methodLabel(method: PaymentMethod): string {
  return PAYMENT_METHODS.find((m) => m.value === method)?.label ?? method
}

/** A schedule problem as a sentence for the form. */
export function describeProblem(problem: ScheduleProblem): string {
  switch (problem.kind) {
    case 'no_instalments':
      return 'Add at least one payment.'
    case 'too_many_instalments':
      return `Use at most ${MAX_INSTALMENTS} payments.`
    case 'invalid_date':
      return `Payment ${problem.index + 1} needs a valid date.`
    case 'date_in_past':
      return `Payment ${problem.index + 1} is in the past.`
    case 'dates_not_increasing':
      return `Payment ${problem.index + 1} must be after payment ${problem.index}.`
    case 'zero_amount':
      return `Payment ${problem.index + 1} needs an amount.`
    case 'total_mismatch':
      return `Payments add up to ${formatCents(problem.actual)} but should total ${formatCents(problem.expected)}.`
  }
}
