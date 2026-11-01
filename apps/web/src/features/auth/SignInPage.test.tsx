// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SignInPage } from './SignInPage'

const sendMagicLink = vi.fn()

vi.mock('../../data/auth', () => ({
  sendMagicLink: (...args: unknown[]) => sendMagicLink(...args),
  signInWithGoogle: vi.fn(),
}))

const authState = { session: null as unknown, loading: false }
vi.mock('./useAuth', () => ({ useAuth: () => authState }))

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/sign-in" element={<SignInPage />} />
        <Route path="*" element={<p>destination page</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('SignInPage', () => {
  beforeEach(() => {
    authState.session = null
    sendMagicLink.mockReset()
  })
  afterEach(cleanup)

  it('offers Google and email sign-in', () => {
    renderAt('/sign-in')
    expect(screen.getByRole('button', { name: /continue with google/i })).toBeTruthy()
    expect(screen.getByLabelText(/email/i)).toBeTruthy()
  })

  it('explains why sign-in is needed when arriving from an invite', () => {
    renderAt('/sign-in?next=%2Finvite%2Fabc')
    expect(screen.getByText(/sign in to accept your invite/i)).toBeTruthy()
  })

  it('sends a magic link that returns to the original destination', async () => {
    sendMagicLink.mockResolvedValue(undefined)
    renderAt('/sign-in?next=%2Finvite%2Fabc')

    await userEvent.type(screen.getByLabelText(/email/i), 'bob@example.test')
    await userEvent.click(screen.getByRole('button', { name: /email me a sign-in link/i }))

    expect(sendMagicLink).toHaveBeenCalledWith('bob@example.test', '/invite/abc')
    expect(await screen.findByText(/check/i)).toBeTruthy()
  })

  it('ignores unsafe redirect targets', async () => {
    sendMagicLink.mockResolvedValue(undefined)
    renderAt('/sign-in?next=%2F%2Fevil.example')

    await userEvent.type(screen.getByLabelText(/email/i), 'bob@example.test')
    await userEvent.click(screen.getByRole('button', { name: /email me a sign-in link/i }))

    expect(sendMagicLink).toHaveBeenCalledWith('bob@example.test', '/')
  })

  it('redirects straight on when already signed in', () => {
    authState.session = { user: { id: 'x' } }
    renderAt('/sign-in?next=%2Fanywhere')
    expect(screen.getByText('destination page')).toBeTruthy()
  })
})
