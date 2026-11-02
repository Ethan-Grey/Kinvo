/**
 * Changing the schedule of a running loan (lender only, ADR-0018).
 *
 * Payments already made in full stay as they are. Everything else can move or
 * change amount, as long as the whole schedule still adds up to what's owed.
 * The database (public.reschedule_loan) is the authority; these checks just
 * explain problems before saving.
 */
import { addDays, addMonths, isIsoDate, type IsoDate } from './dates'
import { allocateProportionally, parseDollars, sumCents, toCents, type Cents } from './money'
import type { Instalment } from './schedule'

export interface ScheduleRow {
  key: string
  dueOn: string
  amountText: string
  /** Already paid towards this payment. */
  paidCents: Cents
  /** Paid in full, so it can't be changed. */
  locked: boolean
}

export type Shift = '1w' | '2w' | '1m'

export const SHIFT_LABELS: Record<Shift, string> = { '1w': '1 week', '2w': '2 weeks', '1m': '1 month' }

/** Moves every payment that isn't fully paid later by the same amount. */
export function shiftUnpaid(rows: readonly ScheduleRow[], by: Shift, direction: 1 | -1 = 1): ScheduleRow[] {
  return rows.map((row) => {
    if (row.locked || !isIsoDate(row.dueOn)) return row
    const dueOn = by === '1m' ? addMonths(row.dueOn, direction) : addDays(row.dueOn, (by === '1w' ? 7 : 14) * direction)
    return { ...row, dueOn }
  })
}

/** Splits what's still to schedule evenly over the payments that aren't fully paid. */
export function splitEvenly(rows: readonly ScheduleRow[], totalCents: Cents): ScheduleRow[] {
  const open = rows.filter((r) => !r.locked)
  if (open.length === 0) return [...rows]
  const lockedTotal = sumCents(rows.filter((r) => r.locked).map(amountOf))
  const shares = allocateProportionally(
    toCents(Math.max(0, totalCents - lockedTotal)),
    open.map(() => 1),
  )
  let i = 0
  return rows.map((row) => (row.locked ? row : { ...row, amountText: centsToText(shares[i++] ?? toCents(0)) }))
}

export function amountOf(row: ScheduleRow): Cents {
  const parsed = parseDollars(row.amountText)
  return parsed.ok ? parsed.cents : toCents(0)
}

export function centsToText(cents: Cents): string {
  return (cents / 100).toFixed(2).replace(/\.00$/, '')
}

/** What's wrong with the schedule, in words, or [] if it can be saved. */
export function scheduleProblems(rows: readonly ScheduleRow[], totalCents: Cents): string[] {
  const problems: string[] = []
  if (rows.length === 0) problems.push('Add at least one payment.')
  if (rows.length > 52) problems.push('Use 52 payments or fewer.')

  let previous: IsoDate | null = null
  rows.forEach((row, index) => {
    const n = index + 1
    if (!isIsoDate(row.dueOn)) {
      problems.push(`Payment ${n} needs a date.`)
    } else {
      if (previous && row.dueOn <= previous) problems.push(`Payment ${n} must be after payment ${index}.`)
      previous = row.dueOn
    }
    const parsed = parseDollars(row.amountText)
    if (!parsed.ok || parsed.cents < 1) problems.push(`Payment ${n} needs an amount over $0.`)
  })

  const sum = sumCents(rows.map(amountOf))
  if (problems.length === 0 && sum !== totalCents) {
    problems.push('The payments must add up to the total owed.')
  }
  return problems
}

export function toInstalments(rows: readonly ScheduleRow[]): Instalment[] {
  return rows.map((row) => ({ dueOn: row.dueOn, amountCents: amountOf(row) }))
}

/** True when the rows say the same as the current schedule. */
export function isUnchanged(rows: readonly ScheduleRow[], current: readonly Instalment[]): boolean {
  return (
    rows.length === current.length &&
    rows.every((row, i) => row.dueOn === current[i]?.dueOn && amountOf(row) === current[i]?.amountCents)
  )
}
