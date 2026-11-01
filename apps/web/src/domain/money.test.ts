import { describe, expect, it } from 'vitest'
import {
  allocateProportionally,
  formatCents,
  parseDollars,
  sumCents,
  toCents,
  type Cents,
} from './money'

const c = (n: number): Cents => toCents(n)

describe('toCents', () => {
  it('accepts whole non-negative numbers', () => {
    expect(toCents(0)).toBe(0)
    expect(toCents(15000)).toBe(15000)
  })

  it.each([1.5, -1, Number.NaN, Number.MAX_SAFE_INTEGER + 1])('rejects %s', (value) => {
    expect(() => toCents(value)).toThrow(RangeError)
  })
})

describe('parseDollars', () => {
  it.each([
    ['200', 20000],
    ['200.5', 20050],
    ['200.50', 20050],
    ['0.05', 5],
    ['$1,250.75', 125075],
    ['  42 ', 4200],
    ['1000000', 100000000],
  ])('parses "%s" as %i cents', (input, expected) => {
    expect(parseDollars(input)).toEqual({ ok: true, cents: expected })
  })

  it('avoids floating-point errors that parseFloat would introduce', () => {
    // parseFloat('0.29') * 100 === 28.999999999999996
    expect(parseDollars('0.29')).toEqual({ ok: true, cents: 29 })
  })

  it.each([
    ['', 'Enter an amount.'],
    ['-5', 'Amount can’t be negative.'],
    ['12.345', 'Enter an amount like 200 or 200.50.'],
    ['abc', 'Enter an amount like 200 or 200.50.'],
    ['1,00', 'Enter an amount like 200 or 200.50.'],
    ['.50', 'Enter an amount like 200 or 200.50.'],
  ])('rejects "%s"', (input, error) => {
    expect(parseDollars(input)).toEqual({ ok: false, error })
  })
})

describe('formatCents', () => {
  it('formats as NZD with two decimal places', () => {
    expect(formatCents(c(15000))).toBe('$150.00')
    expect(formatCents(c(5))).toBe('$0.05')
    expect(formatCents(c(123456789))).toBe('$1,234,567.89')
  })
})

describe('sumCents', () => {
  it('adds amounts exactly', () => {
    expect(sumCents([c(10), c(20), c(30)])).toBe(60)
  })

  it('returns zero for an empty list', () => {
    expect(sumCents([])).toBe(0)
  })
})

describe('allocateProportionally', () => {
  it('splits a charge across equal instalments (ADR-0004 worked example)', () => {
    // $100 charge over two $150 instalments → $50 each
    expect(allocateProportionally(c(10000), [15000, 15000])).toEqual([5000, 5000])
  })

  it('gives leftover cents to the first part', () => {
    expect(allocateProportionally(c(10000), [1, 1, 1])).toEqual([3334, 3333, 3333])
  })

  it('splits in proportion to uneven weights', () => {
    expect(allocateProportionally(c(9000), [1, 2])).toEqual([3000, 6000])
  })

  it('always sums back to the total', () => {
    const totals = [1, 7, 99, 10001, 123457]
    const weightSets = [[1], [3, 1], [5, 7, 11], [1, 1, 1, 1, 1, 1, 1]]
    for (const total of totals) {
      for (const weights of weightSets) {
        const parts = allocateProportionally(c(total), weights)
        expect(parts.reduce((a, b) => a + b, 0)).toBe(total)
      }
    }
  })

  it('rejects invalid weights', () => {
    expect(() => allocateProportionally(c(100), [])).toThrow(RangeError)
    expect(() => allocateProportionally(c(100), [0, 0])).toThrow(RangeError)
    expect(() => allocateProportionally(c(100), [1, -1])).toThrow(RangeError)
  })
})
