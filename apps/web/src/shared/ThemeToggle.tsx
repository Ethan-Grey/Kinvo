import type { ReactNode } from 'react'
import { useTheme, type ThemePreference } from './theme'

const OPTIONS: { value: ThemePreference; label: string; icon: ReactNode }[] = [
  { value: 'light', label: 'Light', icon: <SunIcon /> },
  { value: 'system', label: 'Match device', icon: <AutoIcon /> },
  { value: 'dark', label: 'Dark', icon: <MoonIcon /> },
]

/** Three-way switch: light, match device, dark. */
export function ThemeToggle() {
  const { preference, setPreference } = useTheme()

  return (
    <div role="radiogroup" aria-label="Colour theme" className="inline-flex rounded-xl border border-line bg-canvas p-0.5">
      {OPTIONS.map((option) => {
        const selected = option.value === preference
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={option.label}
            title={option.label}
            onClick={() => setPreference(option.value)}
            className={
              'flex size-8 items-center justify-center rounded-lg transition-colors ' +
              'focus-visible:outline-2 focus-visible:outline-brand-ink ' +
              (selected ? 'bg-surface text-ink shadow-sm' : 'text-ink-muted hover:text-ink')
            }
          >
            {option.icon}
          </button>
        )
      })}
    </div>
  )
}

function SunIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  )
}

function MoonIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z" />
    </svg>
  )
}

function AutoIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="8" />
      <path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor" />
    </svg>
  )
}
