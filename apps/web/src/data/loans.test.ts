import { describe, expect, it } from 'vitest'
import { isAwaitingUser } from './loans'

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
