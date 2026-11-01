import { describe, expect, it } from 'vitest'
import { AppError, toAppError } from './errors'

describe('toAppError', () => {
  it('maps known database error keys to friendly messages', () => {
    const error = toAppError({ message: 'invite_expired' })
    expect(error).toBeInstanceOf(AppError)
    expect(error.code).toBe('invite_expired')
    expect(error.message).toBe('This invite has expired. Ask for a new link.')
  })

  it('hides unexpected errors behind a generic message', () => {
    const error = toAppError({ message: 'duplicate key value violates unique constraint' })
    expect(error.code).toBe('unknown')
    expect(error.message).toBe('Something went wrong. Please try again.')
  })

  it('handles a missing error', () => {
    expect(toAppError(null).code).toBe('unknown')
  })
})
