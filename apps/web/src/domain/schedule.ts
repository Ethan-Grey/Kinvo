/**
 * Repayment schedules: building one quickly, and checking one is valid.
 *
 * The validation rules mirror private.insert_terms in the database, which is
 * the authority (ADR-0003). Checking here too lets the form explain problems
 * instantly instead of after a round trip.
 */
import { addDays, addMonths, isIsoDate, type IsoDate } from './dates'
import { allocateProportionally, toCents, type Cents } from './money'

export interface Instalment {
  dueOn: IsoDate
  amountCents: Cents
}

export type Frequency = 'weekly' | 'fortnightly' | 'monthly'

export const MAX_INSTALMENTS = 52

export interface ScheduleOptions {
  totalCents: Cents
  count: number
  frequency: Frequency
  firstDueOn: IsoDate
}

/**
 * Splits a total into `count` instalments at a regular interval. Amounts are
 * as even as possible; leftover cents go on the first instalment (ADR-0004).
 *
 * Example: $300 over 2 weekly payments from 9 Nov → $150 on 9 Nov, $150 on 16 Nov.
 */
export function buildSchedule({ totalCents, count, frequency, firstDueOn }: ScheduleOptions): Instalment[] {
  if (!Number.isInteger(count) || count < 1 || count > MAX_INSTALMENTS) {
    throw new RangeError(`count must be between 1 and ${MAX_INSTALMENTS}`)
  }
  if (count > totalCents) {
    throw new RangeError('Each instalment must be at least 1 cent')
  }
  const amounts = allocateProportionally(totalCents, Array.from({ length: count }, () => 1))
  return amounts.map((amountCents, index) => ({
    dueOn: dueDate(firstDueOn, frequency, index),
    amountCents,
  }))
}

function dueDate(first: IsoDate, frequency: Frequency, index: number): IsoDate {
  switch (frequency) {
    case 'weekly':
      return addDays(first, 7 * index)
    case 'fortnightly':
      return addDays(first, 14 * index)
    case 'monthly':
      // Count from the first date each time, so 31 Jan → 28 Feb → 31 Mar.
      return addMonths(first, index)
  }
}

export interface TermsDraft {
  principalCents: Cents
  chargeCents: Cents
  instalments: readonly Instalment[]
}

export type ScheduleProblem =
  | { kind: 'no_instalments' }
  | { kind: 'too_many_instalments' }
  | { kind: 'invalid_date'; index: number }
  | { kind: 'date_in_past'; index: number }
  | { kind: 'dates_not_increasing'; index: number }
  | { kind: 'zero_amount'; index: number }
  | { kind: 'total_mismatch'; expected: Cents; actual: Cents }

/** Every problem with a set of terms. An empty list means it's valid. */
export function validateTerms(terms: TermsDraft, today: IsoDate): ScheduleProblem[] {
  const problems: ScheduleProblem[] = []
  const { instalments } = terms

  if (instalments.length === 0) problems.push({ kind: 'no_instalments' })
  if (instalments.length > MAX_INSTALMENTS) problems.push({ kind: 'too_many_instalments' })

  let total = 0
  instalments.forEach((instalment, index) => {
    if (!isIsoDate(instalment.dueOn)) {
      problems.push({ kind: 'invalid_date', index })
    } else {
      if (instalment.dueOn < today) problems.push({ kind: 'date_in_past', index })
      const previous = instalments[index - 1]
      if (previous && isIsoDate(previous.dueOn) && instalment.dueOn <= previous.dueOn) {
        problems.push({ kind: 'dates_not_increasing', index })
      }
    }
    if (instalment.amountCents <= 0) problems.push({ kind: 'zero_amount', index })
    total += instalment.amountCents
  })

  const expected = terms.principalCents + terms.chargeCents
  if (instalments.length > 0 && total !== expected) {
    problems.push({ kind: 'total_mismatch', expected: toCents(expected), actual: toCents(Math.max(0, total)) })
  }
  return problems
}

/**
 * The charge as a percentage of the amount borrowed, for display:
 * $100 on $200 → "50%", $15 on $200 → "7.5%".
 */
export function chargePercent(principalCents: Cents, chargeCents: Cents): string {
  if (principalCents === 0) return '0%'
  const percent = (chargeCents / principalCents) * 100
  const rounded = Math.round(percent * 10) / 10
  return `${rounded.toLocaleString('en-NZ', { maximumFractionDigits: 1 })}%`
}
