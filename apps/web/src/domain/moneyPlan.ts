/**
 * "Safe to spend until pay day" (ADR-0024). Kinvo doesn't see your bank, so it
 * starts from the balance you last entered and works forward:
 *   + every pay that's arrived since then (assumed on its date)
 *   − everything due after that and before your next pay
 * Everything is in cents; balances can be negative.
 */
import { addDays, addMonths, type IsoDate } from './dates'

export type Frequency = 'weekly' | 'fortnightly' | 'monthly' | 'yearly'

/** The n-th date of a schedule (0 = the first). Months count from the first date. */
export function scheduleDate(first: IsoDate, frequency: Frequency, n: number): IsoDate {
  if (frequency === 'weekly') return addDays(first, 7 * n)
  if (frequency === 'fortnightly') return addDays(first, 14 * n)
  return addMonths(first, (frequency === 'yearly' ? 12 : 1) * n)
}

/** Dates of a schedule in (after, upTo] — after exclusive, upTo inclusive. */
export function datesBetween(first: IsoDate, frequency: Frequency, after: IsoDate, upTo: IsoDate): IsoDate[] {
  const out: IsoDate[] = []
  for (let n = 0; n < 1000; n++) {
    const d = scheduleDate(first, frequency, n)
    if (d > upTo) break
    if (d > after) out.push(d)
  }
  return out
}

/** The first schedule date on or after `from`. */
export function nextOnOrAfter(first: IsoDate, frequency: Frequency, from: IsoDate): IsoDate {
  for (let n = 0; n < 1000; n++) {
    const d = scheduleDate(first, frequency, n)
    if (d >= from) return d
  }
  return first
}

export interface Commitment {
  label: string
  dueOn: IsoDate
  cents: number
  kind: 'bill' | 'topup' | 'loan' | 'share'
  /** Already past due but still unpaid: always counts. */
  overdue?: boolean
}

export interface Plan {
  nextPayOn: IsoDate
  daysLeft: number
  /** What's left after everything below, or null without a balance. */
  safeCents: number | null
  perDayCents: number | null
  /** Pay that's arrived since the balance was entered. */
  paysSinceCents: number
  commitments: Commitment[]
  totalCommittedCents: number
}

export function buildPlan(input: {
  today: IsoDate
  pay: { amountCents: number; frequency: Frequency; nextPayOn: IsoDate } | null
  balance: { cents: number; on: IsoDate } | null
  /** Already expanded to dates. */
  commitments: (today: IsoDate, after: IsoDate, before: IsoDate) => Commitment[]
}): Plan | null {
  const { today, pay, balance } = input
  if (!pay) return null
  const nextPayOn = nextOnOrAfter(pay.nextPayOn, pay.frequency, addDays(today, 1))
  // Count from the balance date if it's set and not in the future; otherwise from today.
  const from = balance && balance.on <= today ? balance.on : today
  const lastDayBeforePay = addDays(nextPayOn, -1)
  const paysSince = balance ? datesBetween(pay.nextPayOn, pay.frequency, from, today).length * pay.amountCents : 0
  const commitments = input
    .commitments(today, from, lastDayBeforePay)
    .filter((c) => c.overdue || (c.dueOn > from && c.dueOn <= lastDayBeforePay))
    .sort((a, b) => a.dueOn.localeCompare(b.dueOn))
  const total = commitments.reduce((s, c) => s + c.cents, 0)
  const daysLeft = Math.max(1, Math.round((Date.parse(nextPayOn) - Date.parse(today)) / 86_400_000))
  const safe = balance ? balance.cents + paysSince - total : null
  return {
    nextPayOn,
    daysLeft,
    safeCents: safe,
    perDayCents: safe === null ? null : Math.floor(safe / daysLeft),
    paysSinceCents: paysSince,
    commitments,
    totalCommittedCents: total,
  }
}
