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
