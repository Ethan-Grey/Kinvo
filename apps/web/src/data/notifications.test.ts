import { describe, expect, it } from 'vitest'
import { timeAgo } from './notifications'

describe('timeAgo', () => {
  const now = new Date('2026-11-10T00:00:00Z')
  const ago = (ms: number) => new Date(now.getTime() - ms).toISOString()

  it('rounds down to the largest sensible unit', () => {
    expect(timeAgo(ago(20_000), now)).toBe('just now')
    expect(timeAgo(ago(5 * 60_000), now)).toBe('5m ago')
    expect(timeAgo(ago(3 * 3_600_000), now)).toBe('3h ago')
    expect(timeAgo(ago(2 * 86_400_000), now)).toBe('2d ago')
  })

  it('shows a date after a week', () => {
    expect(timeAgo('2026-11-01T00:00:00Z', now)).toBe('1 Nov')
  })

  it('treats clock skew as just now', () => {
    expect(timeAgo(ago(-60_000), now)).toBe('just now')
  })
})
