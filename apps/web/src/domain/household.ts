/**
 * Household money, worked out from the rows the database keeps (ADR-0022).
 * The database decides what's owed; these just add it up for the screens.
 * Balances can be negative, so they're plain numbers of cents.
 */
import { addDays, type IsoDate } from './dates'
import { toCents, type Cents } from './money'

export interface TabEntry {
  owedTo: string
  owedBy: string
  amountCents: number
  voided: boolean
}

export interface SharedEntry {
  amountCents: number
  occurredOn: IsoDate
  voided: boolean
}

/** What `other` owes `me` overall (negative: I owe them). */
export function netWith(entries: readonly TabEntry[], me: string, other: string): number {
  let net = 0
  for (const e of entries) {
    if (e.voided) continue
    if (e.owedTo === me && e.owedBy === other) net += e.amountCents
    else if (e.owedTo === other && e.owedBy === me) net -= e.amountCents
  }
  return net
}

/** The shared account balance as of a date (entries dated later are scheduled, not yet happened). */
export function balanceOn(entries: readonly SharedEntry[], on: IsoDate): number {
  return entries.filter((e) => !e.voided && e.occurredOn <= on).reduce((sum, e) => sum + e.amountCents, 0)
}

/** The lowest the balance gets over the next `days` days, and when. */
export function lowestAhead(
  entries: readonly SharedEntry[],
  from: IsoDate,
  days: number,
): { cents: number; on: IsoDate } {
  let lowest = { cents: balanceOn(entries, from), on: from }
  for (let i = 1; i <= days; i++) {
    const day = addDays(from, i)
    const cents = balanceOn(entries, day)
    if (cents < lowest.cents) lowest = { cents, on: day }
  }
  return lowest
}

/**
 * The fewest payments that clear everyone's balances, given each person's
 * overall position (positive = they're owed). Largest debtor pays largest creditor first.
 */
export function settlePlan(positions: Readonly<Record<string, number>>): { from: string; to: string; cents: Cents }[] {
  const owed = Object.entries(positions)
    .filter(([, c]) => c > 0)
    .map(([id, c]) => ({ id, c }))
    .sort((a, b) => b.c - a.c)
  const owing = Object.entries(positions)
    .filter(([, c]) => c < 0)
    .map(([id, c]) => ({ id, c: -c }))
    .sort((a, b) => b.c - a.c)
  const plan: { from: string; to: string; cents: Cents }[] = []
  let i = 0
  let j = 0
  while (i < owing.length && j < owed.length) {
    const debtor = owing[i]
    const creditor = owed[j]
    if (!debtor || !creditor) break
    const cents = Math.min(debtor.c, creditor.c)
    if (cents > 0) plan.push({ from: debtor.id, to: creditor.id, cents: toCents(cents) })
    debtor.c -= cents
    creditor.c -= cents
    if (debtor.c === 0) i++
    if (creditor.c === 0) j++
  }
  return plan
}

/** Each person's overall position in the household (positive = owed to them). */
export function positions(entries: readonly TabEntry[], members: readonly string[]): Record<string, number> {
  const out: Record<string, number> = Object.fromEntries(members.map((m) => [m, 0]))
  for (const e of entries) {
    if (e.voided) continue
    out[e.owedTo] = (out[e.owedTo] ?? 0) + e.amountCents
    out[e.owedBy] = (out[e.owedBy] ?? 0) - e.amountCents
  }
  return out
}

/** Equal shares in basis points (10000 = 100%); the first takes any remainder. */
export function equalShares(members: readonly string[]): { userId: string; shareBp: number }[] {
  const n = members.length
  return members.map((userId, i) => ({
    userId,
    shareBp: Math.floor(10000 / n) + (i === 0 ? 10000 % n : 0),
  }))
}

export interface MonthInput {
  expenses: readonly {
    category: string
    amountCents: number
    spentOn: IsoDate
    paidBy: string | null
    voided: boolean
  }[]
  bills: readonly {
    category: string
    amountCents: number | null
    dueOn: IsoDate
    payerId: string | null
    method: string
    skipped: boolean
    shares: readonly { userId: string; amountCents: number; paid: boolean }[]
  }[]
  topups: readonly { memberId: string | null; amountCents: number; occurredOn: IsoDate; voided: boolean }[]
}

export interface MonthSummary {
  totalCents: number
  /** Category → cents, largest first. */
  byCategory: { category: string; cents: number }[]
  /** Who paid (user id, or 'shared' for the shared account) → cents. */
  paidBy: Record<string, number>
  /** Top-ups into the shared account, by person. */
  toppedUp: Record<string, number>
}

/** "2026-11" for a date. */
export const monthOf = (date: IsoDate) => date.slice(0, 7)

/** What the household spent in a month, by category and by who paid. Bills count on their due date. */
export function monthSummary(input: MonthInput, month: string): MonthSummary {
  const byCategory = new Map<string, number>()
  const paidBy: Record<string, number> = {}
  const add = (category: string, cents: number) => byCategory.set(category, (byCategory.get(category) ?? 0) + cents)
  const pay = (who: string, cents: number) => (paidBy[who] = (paidBy[who] ?? 0) + cents)
  let total = 0

  for (const e of input.expenses) {
    if (e.voided || monthOf(e.spentOn) !== month) continue
    total += e.amountCents
    add(e.category, e.amountCents)
    pay(e.paidBy ?? 'shared', e.amountCents)
  }
  for (const b of input.bills) {
    if (b.skipped || b.amountCents === null || monthOf(b.dueOn) !== month) continue
    total += b.amountCents
    add(b.category, b.amountCents)
    if (b.method === 'shared_account') pay('shared', b.amountCents)
    else if (b.method === 'each_own') for (const s of b.shares) pay(s.userId, s.amountCents)
    else if (b.payerId) pay(b.payerId, b.amountCents)
  }
  const toppedUp: Record<string, number> = {}
  for (const t of input.topups) {
    if (t.voided || !t.memberId || monthOf(t.occurredOn) !== month) continue
    toppedUp[t.memberId] = (toppedUp[t.memberId] ?? 0) + t.amountCents
  }
  return {
    totalCents: total,
    byCategory: [...byCategory.entries()]
      .map(([category, cents]) => ({ category, cents }))
      .sort((a, b) => b.cents - a.cents),
    paidBy,
    toppedUp,
  }
}

/** The month before or after "2026-11". */
export function shiftMonth(month: string, by: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number]
  const d = new Date(Date.UTC(y, m - 1 + by, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}
