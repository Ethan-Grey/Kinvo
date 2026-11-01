/**
 * Light / dark theme.
 *
 * The user picks "system", "light" or "dark". The choice is saved per device,
 * and resolved to an actual theme on <html data-theme="…">. With "system",
 * the theme follows the phone or computer setting, including live changes.
 *
 * index.html contains a tiny copy of `resolveTheme` that runs before React
 * loads, so the page never flashes the wrong colours.
 */
import { useCallback, useEffect, useState } from 'react'

export type ThemePreference = 'system' | 'light' | 'dark'
export type Theme = 'light' | 'dark'

export const THEME_STORAGE_KEY = 'kinvo.theme'

/** Browser bar colour for each theme, matching the header. */
const THEME_COLORS: Record<Theme, string> = { light: '#ffffff', dark: '#141e1a' }

export function resolveTheme(preference: ThemePreference, systemPrefersDark: boolean): Theme {
  if (preference === 'system') return systemPrefersDark ? 'dark' : 'light'
  return preference
}

export function readPreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY)
    return stored === 'light' || stored === 'dark' ? stored : 'system'
  } catch {
    return 'system'
  }
}

function savePreference(preference: ThemePreference): void {
  try {
    if (preference === 'system') localStorage.removeItem(THEME_STORAGE_KEY)
    else localStorage.setItem(THEME_STORAGE_KEY, preference)
  } catch {
    // Storage unavailable (private mode): the choice lasts for this visit only.
  }
}

/** The device's dark-mode setting, if the browser can report it. */
const darkQuery = (): MediaQueryList | null =>
  typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)') : null

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLORS[theme])
}

/** Current preference, the resolved theme, and a setter that applies and saves it. */
export function useTheme() {
  const [preference, setPreferenceState] = useState<ThemePreference>(readPreference)
  const [systemDark, setSystemDark] = useState(() => darkQuery()?.matches ?? false)

  // Follow the device setting while on "system".
  useEffect(() => {
    const query = darkQuery()
    if (!query) return
    const onChange = (event: MediaQueryListEvent) => setSystemDark(event.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  const theme = resolveTheme(preference, systemDark)
  useEffect(() => applyTheme(theme), [theme])

  const setPreference = useCallback((next: ThemePreference) => {
    savePreference(next)
    setPreferenceState(next)
  }, [])

  return { preference, theme, setPreference }
}
