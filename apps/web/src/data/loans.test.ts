import { describe, expect, it } from 'vitest'
import { toCents } from '../domain/money'
import { borrowerCharge, isAwaitingUser, type TermsVersion } from './loans'

describe('isAwaitingUser', () => {
  const me = 'me'
  const them = 'them'

  it('is my turn when the other person made the latest proposal', () => {
    expect(isAwaitingUser('negotiating', 'borrower', them, me)).toBe(true)
  })

  it('is not my turn after I propose', () => {
    expect(isAwaitingUser('negotiating', 'lender', me, me)).toBe(false)
  })

  it('is the lender’s turn once terms are agreed (send the money)', () => {
    expect(isAwaitingUser('agreed', 'lender', me, me)).toBe(true)
    expect(isAwaitingUser('agreed', 'borrower', them, me)).toBe(false)
  })

  it('needs nothing from anyone on closed loans', () => {
    expect(isAwaitingUser('rejected', 'lender', them, me)).toBe(false)
    expect(isAwaitingUser('active', 'borrower', them, me)).toBe(false)
  })
})

const version = (v: number, proposedBy: string, principal: number, charge: number) =>
  ({ version: v, proposedBy, principalCents: toCents(principal), chargeCents: toCents(charge) }) as TermsVersion

describe('borrowerCharge', () => {
  it('is zero before the lender has proposed anything', () => {
    expect(borrowerCharge(null, 20000)).toBe(0)
    expect(borrowerCharge({ lenderId: 'lena', history: [version(1, 'bob', 20000, 0)] }, 20000)).toBe(0)
  })

  it('applies the lender’s latest rate to the new amount, to the nearest cent', () => {
    const loan = {
      lenderId: 'lena',
      history: [version(1, 'bob', 20000, 0), version(2, 'lena', 20000, 2000), version(3, 'bob', 10000, 1000)],
    }
    expect(borrowerCharge(loan, 10000)).toBe(1000)
    expect(borrowerCharge(loan, 3333)).toBe(333)
  })

  it('follows the lender if they later drop the charge', () => {
    const loan = { lenderId: 'lena', history: [version(2, 'lena', 20000, 2000), version(4, 'lena', 20000, 0)] }
    expect(borrowerCharge(loan, 15000)).toBe(0)
  })
})
