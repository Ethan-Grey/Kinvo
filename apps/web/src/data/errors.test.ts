import { describe, expect, it, vi } from 'vitest'
import { AppError, toAppError } from './errors'

describe('toAppError', () => {
  it('maps known database error keys to friendly messages', () => {
    const error = toAppError({ message: 'invite_expired' })
    expect(error).toBeInstanceOf(AppError)
    expect(error.code).toBe('invite_expired')
    expect(error.message).toBe('This invite has expired. Ask for a new link.')
  })

  it('maps Supabase Auth error codes', () => {
    const error = toAppError({ code: 'email_address_not_authorized', message: 'Email address not authorized' })
    expect(error.code).toBe('email_address_not_authorized')
    expect(error.message).toMatch(/can’t send email to that address/)
  })

  it('treats any 429 as a rate limit', () => {
    expect(toAppError({ status: 429, message: 'For security purposes, wait 41 seconds' }).code).toBe('rate_limited')
  })

  it('hides unexpected errors behind a generic message', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const error = toAppError({ message: 'duplicate key value violates unique constraint' })
    expect(error.code).toBe('unknown')
    expect(error.message).toBe('Something went wrong. Please try again.')
  })

  it('handles a missing error', () => {
    expect(toAppError(null).code).toBe('unknown')
  })
})
