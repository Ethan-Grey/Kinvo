import { describe, expect, it } from 'vitest'
import {
  balanceOn,
  equalShares,
  lowestAhead,
  monthSummary,
  netWith,
  positions,
  settlePlan,
  shiftMonth,
} from './household'

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

describe('monthSummary', () => {
  it('adds up spending and bills for the month, by category and payer', () => {
    const s = monthSummary(
      {
        expenses: [
          { category: 'groceries', amountCents: 12000, spentOn: '2026-11-03', paidBy: 'me', voided: false },
          { category: 'groceries', amountCents: 8000, spentOn: '2026-11-10', paidBy: null, voided: false },
          { category: 'takeaways', amountCents: 3000, spentOn: '2026-10-30', paidBy: 'me', voided: false },
          { category: 'fun', amountCents: 999, spentOn: '2026-11-11', paidBy: 'me', voided: true },
        ],
        bills: [
          {
            category: 'rent',
            amountCents: 60000,
            dueOn: '2026-11-04',
            payerId: null,
            method: 'shared_account',
            skipped: false,
            shares: [],
          },
          {
            category: 'power',
            amountCents: null,
            dueOn: '2026-11-20',
            payerId: 'hana',
            method: 'one_person',
            skipped: false,
            shares: [],
          },
          {
            category: 'rent',
            amountCents: 60000,
            dueOn: '2026-11-11',
            payerId: null,
            method: 'shared_account',
            skipped: true,
            shares: [],
          },
        ],
        topups: [{ memberId: 'me', amountCents: 35000, occurredOn: '2026-11-02', voided: false }],
      },
      '2026-11',
    )
    expect(s.totalCents).toBe(80000)
    expect(s.byCategory).toEqual([
      { category: 'rent', cents: 60000 },
      { category: 'groceries', cents: 20000 },
    ])
    expect(s.paidBy).toEqual({ me: 12000, shared: 68000 })
    expect(s.toppedUp).toEqual({ me: 35000 })
  })

  it('moves between months', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12')
    expect(shiftMonth('2026-12', 1)).toBe('2027-01')
  })
})
