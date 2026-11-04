/**
 * Splitting a bill between the person who paid and others (ADR-0020).
 * Shares are whole cents and never add up to more than the bill. When it
 * doesn't divide evenly, the person who paid takes the odd cent.
 */
import { allocateProportionally, parseDollars, sumCents, toCents, type Cents } from './money'

export type SplitMode = 'even' | 'percent' | 'amount'

export interface SplitInput {
  totalCents: Cents
  mode: SplitMode
  /** People sharing, not counting you. */
  people: readonly string[]
  /** Whether you have a share too (e.g. groceries you'll also eat). */
  includeMe: boolean
  /** Per person: a percentage ("25") or an amount ("30.50"), by mode. */
  values: Readonly<Record<string, string>>
}

export interface SplitResult {
  shares: Record<string, Cents>
  myShareCents: Cents
  problems: string[]
}

export function splitBill({ totalCents, mode, people, includeMe, values }: SplitInput): SplitResult {
  const shares: Record<string, Cents> = {}
  const problems: string[] = []
  if (people.length === 0) return { shares, myShareCents: totalCents, problems: ['Choose who it’s split with.'] }

  if (mode === 'even') {
    const parts = allocateProportionally(totalCents, Array(people.length + (includeMe ? 1 : 0)).fill(1))
    const theirs = includeMe ? parts.slice(1) : parts
    people.forEach((p, i) => (shares[p] = theirs[i] ?? toCents(0)))
  } else {
    for (const p of people) {
      const text = (values[p] ?? '').trim()
      if (mode === 'percent') {
        const pct = Number(text)
        if (text === '' || !Number.isFinite(pct) || pct <= 0 || pct > 100) {
          problems.push('Give each person a percentage between 0 and 100.')
          shares[p] = toCents(0)
        } else {
          shares[p] = toCents(Math.round((totalCents * pct) / 100))
        }
      } else {
        const parsed = parseDollars(text)
        if (!parsed.ok || parsed.cents < 1) {
          problems.push('Give each person an amount over $0.')
          shares[p] = toCents(0)
        } else {
          shares[p] = parsed.cents
        }
      }
    }
  }

  const theirTotal = sumCents(Object.values(shares))
  if (theirTotal > totalCents) problems.push('The shares add up to more than the bill.')
  if (Object.values(shares).some((c) => c < 1) && mode === 'even')
    problems.push('The bill is too small to split that many ways.')
  return { shares, myShareCents: toCents(Math.max(0, totalCents - theirTotal)), problems: [...new Set(problems)] }
}
