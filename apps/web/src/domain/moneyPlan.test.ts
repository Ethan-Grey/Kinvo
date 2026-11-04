import { describe, expect, it } from 'vitest'
import { buildPlan, datesBetween, nextOnOrAfter, scheduleDate } from './moneyPlan'

describe('schedules', () => {
  it('steps weekly, monthly and yearly', () => {
    expect(scheduleDate('2026-01-31', 'monthly', 1)).toBe('2026-02-28')
    expect(scheduleDate('2026-03-01', 'yearly', 1)).toBe('2027-03-01')
    expect(datesBetween('2026-11-02', 'weekly', '2026-11-02', '2026-11-20')).toEqual(['2026-11-09', '2026-11-16'])
    expect(nextOnOrAfter('2026-10-01', 'fortnightly', '2026-11-05')).toBe('2026-11-12')
  })
})

describe('buildPlan', () => {
  const pay = { amountCents: 120000, frequency: 'fortnightly' as const, nextPayOn: '2026-11-12' }
  const bills = (_t: string, after: string, before: string) =>
    datesBetween('2026-10-08', 'monthly', after, before).map((dueOn) => ({
      label: 'Phone',
      dueOn,
      cents: 4500,
      kind: 'bill' as const,
    }))

  it('takes what’s due before pay day off the balance', () => {
    const plan = buildPlan({
      today: '2026-11-05',
      pay,
      balance: { cents: 50000, on: '2026-11-05' },
      commitments: bills,
    })
    expect(plan?.nextPayOn).toBe('2026-11-12')
    expect(plan?.commitments.map((c) => c.dueOn)).toEqual(['2026-11-08'])
    expect(plan?.safeCents).toBe(45500)
    expect(plan?.daysLeft).toBe(7)
    expect(plan?.perDayCents).toBe(6500)
  })

  it('adds pay that arrived since the balance was entered', () => {
    const plan = buildPlan({
      today: '2026-11-13',
      pay,
      balance: { cents: 10000, on: '2026-11-10' },
      commitments: () => [],
    })
    expect(plan?.paysSinceCents).toBe(120000)
    expect(plan?.nextPayOn).toBe('2026-11-26')
    expect(plan?.safeCents).toBe(130000)
  })

  it('needs pay to plan, and a balance to say what’s safe', () => {
    expect(buildPlan({ today: '2026-11-05', pay: null, balance: null, commitments: bills })).toBeNull()
    expect(buildPlan({ today: '2026-11-05', pay, balance: null, commitments: bills })?.safeCents).toBeNull()
  })
})
