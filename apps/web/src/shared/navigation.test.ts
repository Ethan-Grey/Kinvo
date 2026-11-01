import { describe, expect, it } from 'vitest'
import { safeNextPath } from './navigation'

describe('safeNextPath', () => {
  it.each(['/', '/invite/abc123', '/people?tab=borrowers'])('keeps in-app path %s', (path) => {
    expect(safeNextPath(path)).toBe(path)
  })

  it.each([
    null,
    undefined,
    '',
    'https://evil.example',
    '//evil.example',
    '/\\evil.example',
    'javascript:alert(1)',
  ])('rejects %s', (path) => {
    expect(safeNextPath(path)).toBe('/')
  })
})
