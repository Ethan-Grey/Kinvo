import { describe, expect, it } from 'vitest'
import { balanceOn, equalShares, lowestAhead, netWith, positions, settlePlan } from './household'

const tab = [
  { owedTo: 'me', owedBy: 'hana', amountCents: 3000, voided: false },
  { owedTo: 'hana', owedBy: 'me', amountCents: 1000, voided: false },
  { owedTo: 'me', owedBy: 'hana', amountCents: 9999, voided: true },
]

describe('household sums', () => {
  it('nets what two people owe each other, ignoring undone entries', () => {
    expect(netWith(tab, 'me', 'hana')).toBe(2000)
    expect(netWith(tab, 'hana', 'me')).toBe(-2000)
  })

  it('works out the shared balance on a day, and the lowest point ahead', () => {
    const entries = [
      { amountCents: 50000, occurredOn: '2026-11-01', voided: false },
      { amountCents: -60000, occurredOn: '2026-11-06', voided: false },
      { amountCents: 35000, occurredOn: '2026-11-09', voided: false },
    ]
    expect(balanceOn(entries, '2026-11-05')).toBe(50000)
    expect(lowestAhead(entries, '2026-11-05', 7)).toEqual({ cents: -10000, on: '2026-11-06' })
  })

  it('finds the fewest payments to settle three people', () => {
    const p = positions(
      [
        { owedTo: 'a', owedBy: 'b', amountCents: 5000, voided: false },
        { owedTo: 'b', owedBy: 'c', amountCents: 5000, voided: false },
      ],
      ['a', 'b', 'c'],
    )
    expect(settlePlan(p)).toEqual([{ from: 'c', to: 'a', cents: 5000 }])
  })

  it('splits evenly in basis points', () => {
    expect(equalShares(['a', 'b', 'c']).map((s) => s.shareBp)).toEqual([3334, 3333, 3333])
  })
})
