import { describe, expect, it } from 'vitest'
import { toCents } from './money'
import { splitBill } from './split'

const base = { totalCents: toCents(12000), people: ['hana'], includeMe: true, values: {} }

describe('splitBill', () => {
  it('splits evenly, with the payer taking any odd cent', () => {
    expect(splitBill({ ...base, mode: 'even' })).toEqual({ shares: { hana: 6000 }, myShareCents: 6000, problems: [] })
    const three = splitBill({ ...base, totalCents: toCents(10000), people: ['a', 'b'], mode: 'even' })
    expect(three.shares).toEqual({ a: 3333, b: 3333 })
    expect(three.myShareCents).toBe(3334)
  })

  it('can leave the payer out', () => {
    expect(splitBill({ ...base, includeMe: false, people: ['a', 'b'], mode: 'even' }).shares).toEqual({
      a: 6000,
      b: 6000,
    })
  })

  it('splits by percentage and by amount', () => {
    expect(splitBill({ ...base, mode: 'percent', values: { hana: '30' } }).shares).toEqual({ hana: 3600 })
    const byAmount = splitBill({ ...base, mode: 'amount', values: { hana: '45' } })
    expect(byAmount.shares).toEqual({ hana: 4500 })
    expect(byAmount.myShareCents).toBe(7500)
  })

  it('explains problems', () => {
    expect(splitBill({ ...base, mode: 'amount', values: { hana: '130' } }).problems).toEqual([
      'The shares add up to more than the bill.',
    ])
    expect(splitBill({ ...base, mode: 'percent', values: { hana: '' } }).problems).toContain(
      'Give each person a percentage between 0 and 100.',
    )
    expect(splitBill({ ...base, people: [], mode: 'even' }).problems).toEqual(['Choose who it’s split with.'])
  })
})
