import { describe, expect, it } from 'vitest'
import { pageTitle } from './pageTitle'

describe('pageTitle', () => {
  it('names each screen', () => {
    expect(pageTitle('/')).toBe('Home · Kinvo')
    expect(pageTitle('/loans')).toBe('Owed · Kinvo')
    expect(pageTitle('/loans/new')).toBe('Add what’s owed · Kinvo')
    expect(pageTitle('/loans/3f2a')).toBe('Details · Kinvo')
    expect(pageTitle('/people/r1')).toBe('Person · Kinvo')
    expect(pageTitle('/account')).toBe('Account · Kinvo')
    expect(pageTitle('/loans/3f2a/pay')).toBe('Record a payment · Kinvo')
    expect(pageTitle('/loans/3f2a/accept')).toBe('Accept · Kinvo')
  })
})
