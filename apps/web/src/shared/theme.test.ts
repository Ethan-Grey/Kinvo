// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { applyTheme, readPreference, resolveTheme, THEME_STORAGE_KEY } from './theme'

afterEach(() => localStorage.clear())

describe('resolveTheme', () => {
  it('follows the device on "system"', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
  })

  it('uses an explicit choice regardless of the device', () => {
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
  })
})

describe('readPreference', () => {
  it('defaults to system', () => {
    expect(readPreference()).toBe('system')
  })

  it('reads a saved choice and ignores junk', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark')
    expect(readPreference()).toBe('dark')
    localStorage.setItem(THEME_STORAGE_KEY, 'purple')
    expect(readPreference()).toBe('system')
  })
})

describe('applyTheme', () => {
  it('sets data-theme on <html>', () => {
    applyTheme('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
  })
})
