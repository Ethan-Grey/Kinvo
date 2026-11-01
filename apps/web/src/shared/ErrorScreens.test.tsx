// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppErrorBoundary, ConfigErrorScreen } from './ErrorScreens'

afterEach(cleanup)

function Boom(): never {
  throw new Error('kaboom')
}

describe('AppErrorBoundary', () => {
  it('shows a recovery screen instead of a blank page when rendering fails', () => {
    // React logs caught errors; keep test output clean.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(
      <AppErrorBoundary>
        <Boom />
      </AppErrorBoundary>,
    )
    expect(screen.getByRole('heading', { name: /something went wrong/i })).toBeTruthy()
    expect(screen.getByRole('button', { name: /reload/i })).toBeTruthy()
    consoleError.mockRestore()
  })

  it('renders children when nothing fails', () => {
    render(
      <AppErrorBoundary>
        <p>all good</p>
      </AppErrorBoundary>,
    )
    expect(screen.getByText('all good')).toBeTruthy()
  })
})

describe('ConfigErrorScreen', () => {
  it('names the missing settings', () => {
    render(<ConfigErrorScreen />)
    expect(screen.getByText('VITE_SUPABASE_URL')).toBeTruthy()
    expect(screen.getByText('VITE_SUPABASE_PUBLISHABLE_KEY')).toBeTruthy()
  })
})
