import { describe, expect, it } from 'vitest'
import { toCents } from './money'
import { isUnchanged, scheduleProblems, shiftUnpaid, splitEvenly, toInstalments, type ScheduleRow } from './reschedule'

const row = (dueOn: string, amountText: string, locked = false, paid = 0): ScheduleRow => ({
  key: dueOn,
  dueOn,
  amountText,
  paidCents: toCents(paid),
  locked,
})

describe('shiftUnpaid', () => {
  it('moves only payments that are not fully paid', () => {
    const rows = [row('2026-11-01', '50', true), row('2026-11-15', '50'), row('2026-12-31', '50')]
    expect(shiftUnpaid(rows, '1w').map((r) => r.dueOn)).toEqual(['2026-11-01', '2026-11-22', '2027-01-07'])
    expect(shiftUnpaid(rows, '1m').map((r) => r.dueOn)).toEqual(['2026-11-01', '2026-12-15', '2027-01-31'])
    expect(shiftUnpaid(rows, '1w', -1).map((r) => r.dueOn)).toEqual(['2026-11-01', '2026-11-08', '2026-12-24'])
  })
})

describe('splitEvenly', () => {
  it('spreads what is left over the unpaid payments, keeping paid ones', () => {
    const rows = [row('2026-11-01', '50', true), row('2026-11-15', '1'), row('2026-11-29', '1'), row('2026-12-13', '1')]
    expect(splitEvenly(rows, toCents(15000)).map((r) => r.amountText)).toEqual(['50', '33.34', '33.33', '33.33'])
  })
})

describe('scheduleProblems', () => {
  it('accepts a schedule that adds up, in date order', () => {
    expect(scheduleProblems([row('2026-11-01', '50', true), row('2026-11-20', '150')], toCents(20000))).toEqual([])
  })

  it('explains what is wrong', () => {
    expect(scheduleProblems([row('2026-11-20', '50'), row('2026-11-10', '0')], toCents(5000))).toEqual([
      'Payment 2 must be after payment 1.',
      'Payment 2 needs an amount over $0.',
    ])
    expect(scheduleProblems([row('2026-11-20', '50')], toCents(6000))).toEqual([
      'The payments must add up to the total owed.',
    ])
    expect(scheduleProblems([row('', '60')], toCents(6000))).toEqual(['Payment 1 needs a date.'])
  })
})

describe('isUnchanged', () => {
  it('compares dates and amounts', () => {
    const rows = [row('2026-11-20', '60')]
    expect(isUnchanged(rows, toInstalments(rows))).toBe(true)
    expect(isUnchanged(rows, [{ dueOn: '2026-11-21', amountCents: toCents(6000) }])).toBe(false)
  })
})
