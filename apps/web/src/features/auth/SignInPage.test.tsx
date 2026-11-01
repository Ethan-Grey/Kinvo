// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppError } from '../../data/errors'
import { SignInPage } from './SignInPage'

const sendSignInCode = vi.fn()
const verifySignInCode = vi.fn()

vi.mock('../../data/auth', () => ({
  sendSignInCode: (...args: unknown[]) => sendSignInCode(...args),
  verifySignInCode: (...args: unknown[]) => verifySignInCode(...args),
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

async function requestCode(email = 'bob@example.test') {
  await userEvent.type(screen.getByLabelText(/email/i), email)
  await userEvent.click(screen.getByRole('button', { name: /email me a code/i }))
}

describe('SignInPage', () => {
  beforeEach(() => {
    authState.session = null
    sendSignInCode.mockReset().mockResolvedValue(undefined)
    verifySignInCode.mockReset().mockResolvedValue(undefined)
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

  it('sends a code, then signs in with it', async () => {
    renderAt('/sign-in?next=%2Finvite%2Fabc')
    await requestCode()

    expect(sendSignInCode).toHaveBeenCalledWith('bob@example.test', '/invite/abc')
    expect(screen.getByText(/we sent a code to/i)).toBeTruthy()

    await userEvent.type(screen.getByLabelText(/sign-in code/i), '12 34 56')
    await userEvent.click(screen.getByRole('button', { name: /^sign in$/i }))

    expect(verifySignInCode).toHaveBeenCalledWith('bob@example.test', '123456')
  })

  it('shows why a code was rejected', async () => {
    verifySignInCode.mockRejectedValue(new AppError('otp_expired'))
    renderAt('/sign-in')
    await requestCode()

    await userEvent.type(screen.getByLabelText(/sign-in code/i), '000000')
    await userEvent.click(screen.getByRole('button', { name: /^sign in$/i }))

    expect(await screen.findByText(/expired or was already used/i)).toBeTruthy()
  })

  it('shows why an email could not be sent', async () => {
    sendSignInCode.mockRejectedValue(new AppError('over_email_send_rate_limit'))
    renderAt('/sign-in')
    await requestCode()

    expect(await screen.findByText(/too many sign-in emails/i)).toBeTruthy()
  })

  it('ignores unsafe redirect targets', async () => {
    renderAt('/sign-in?next=%2F%2Fevil.example')
    await requestCode()
    expect(sendSignInCode).toHaveBeenCalledWith('bob@example.test', '/')
  })

  it('redirects straight on when already signed in', () => {
    authState.session = { user: { id: 'x' } }
    renderAt('/sign-in?next=%2Fanywhere')
    expect(screen.getByText('destination page')).toBeTruthy()
  })
})
