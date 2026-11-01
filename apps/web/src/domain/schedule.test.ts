import { describe, expect, it } from 'vitest'
import { addDays, addMonths, isIsoDate, todayInNZ } from './dates'
import { toCents } from './money'
import { buildSchedule, chargePercent, validateTerms } from './schedule'

const c = toCents

describe('dates', () => {
  it('adds days across month and year ends', () => {
    expect(addDays('2026-12-28', 7)).toBe('2027-01-04')
  })

  it('clamps months to the end of shorter months', () => {
    expect(addMonths('2027-01-31', 1)).toBe('2027-02-28')
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29')
  })

  it('is unaffected by daylight saving', () => {
    // NZ daylight saving starts on 27 Sep 2026.
    expect(addDays('2026-09-26', 1)).toBe('2026-09-27')
    expect(addDays('2026-09-27', 1)).toBe('2026-09-28')
  })

  it('validates ISO dates', () => {
    expect(isIsoDate('2026-11-09')).toBe(true)
    expect(isIsoDate('2026-02-30')).toBe(false)
    expect(isIsoDate('9/11/2026')).toBe(false)
  })

  it('works out today in New Zealand, not the device time zone', () => {
    // 11pm UTC on 1 Nov is already 2 Nov in NZ (UTC+13).
    expect(todayInNZ(new Date('2026-11-01T23:00:00Z'))).toBe('2026-11-02')
  })
})

describe('buildSchedule', () => {
  it('builds the brief’s example: $300 over two weekly payments', () => {
    expect(buildSchedule({ totalCents: c(30000), count: 2, frequency: 'weekly', firstDueOn: '2026-11-09' })).toEqual([
      { dueOn: '2026-11-09', amountCents: 15000 },
      { dueOn: '2026-11-16', amountCents: 15000 },
    ])
  })

  it('puts leftover cents on the first instalment', () => {
    const schedule = buildSchedule({ totalCents: c(10000), count: 3, frequency: 'fortnightly', firstDueOn: '2026-11-09' })
    expect(schedule.map((i) => i.amountCents)).toEqual([3334, 3333, 3333])
    expect(schedule.map((i) => i.dueOn)).toEqual(['2026-11-09', '2026-11-23', '2026-12-07'])
  })

  it('keeps monthly dates anchored to the first date', () => {
    const schedule = buildSchedule({ totalCents: c(300), count: 3, frequency: 'monthly', firstDueOn: '2027-01-31' })
    expect(schedule.map((i) => i.dueOn)).toEqual(['2027-01-31', '2027-02-28', '2027-03-31'])
  })

  it('rejects impossible counts', () => {
    expect(() => buildSchedule({ totalCents: c(100), count: 0, frequency: 'weekly', firstDueOn: '2026-11-09' })).toThrow()
    expect(() => buildSchedule({ totalCents: c(2), count: 3, frequency: 'weekly', firstDueOn: '2026-11-09' })).toThrow()
  })
})

describe('validateTerms', () => {
  const today = '2026-11-02'

  it('accepts valid terms', () => {
    const terms = {
      principalCents: c(20000),
      chargeCents: c(10000),
      instalments: [
        { dueOn: '2026-11-09', amountCents: c(15000) },
        { dueOn: '2026-11-16', amountCents: c(15000) },
      ],
    }
    expect(validateTerms(terms, today)).toEqual([])
  })

  it('reports a total that doesn’t match principal + charge', () => {
    const terms = { principalCents: c(20000), chargeCents: c(0), instalments: [{ dueOn: '2026-11-09', amountCents: c(19000) }] }
    expect(validateTerms(terms, today)).toEqual([{ kind: 'total_mismatch', expected: 20000, actual: 19000 }])
  })

  it('reports past, repeated and malformed dates', () => {
    const terms = {
      principalCents: c(300),
      chargeCents: c(0),
      instalments: [
        { dueOn: '2026-11-01', amountCents: c(100) },
        { dueOn: '2026-11-01', amountCents: c(100) },
        { dueOn: 'soon', amountCents: c(100) },
      ],
    }
    expect(validateTerms(terms, today).map((p) => p.kind)).toEqual([
      'date_in_past',
      'date_in_past',
      'dates_not_increasing',
      'invalid_date',
    ])
  })

  it('requires at least one instalment', () => {
    expect(validateTerms({ principalCents: c(100), chargeCents: c(0), instalments: [] }, today)).toEqual([
      { kind: 'no_instalments' },
    ])
  })
})

describe('chargePercent', () => {
  it.each([
    [20000, 10000, '50%'],
    [20000, 1500, '7.5%'],
    [30000, 10000, '33.3%'],
    [20000, 0, '0%'],
  ])('%i with a charge of %i is %s', (principal, charge, expected) => {
    expect(chargePercent(c(principal), c(charge))).toBe(expected)
  })
})
