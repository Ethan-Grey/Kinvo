// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Profile } from '../../data/database.types'
import { exportFileName } from '../../data/account'
import { AccountPage } from './AccountPage'
import { expectNoAxeViolations } from '../../test/axe'

const api = vi.hoisted(() => ({
  getMyProfile: vi.fn(),
  setDisplayName: vi.fn(),
  setEmailNotifications: vi.fn(),
  exportMyData: vi.fn(),
}))
vi.mock('../../data/people', () => ({ getMyProfile: api.getMyProfile }))
vi.mock('../../data/account', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../data/account')>()),
  setDisplayName: api.setDisplayName,
  setEmailNotifications: api.setEmailNotifications,
  exportMyData: api.exportMyData,
}))
vi.mock('../auth/useAuth', () => ({ useAuth: () => ({ session: { user: { id: 'me' } }, loading: false }) }))

const profile: Profile = {
  id: 'me',
  display_name: 'Bob Borrower',
  email: 'bob@example.test',
  can_lend: false,
  created_at: '2026-11-01T00:00:00Z',
  email_notifications: true,
}

function renderPage() {
  return render(
    <MemoryRouter>
      <AccountPage />
    </MemoryRouter>,
  )
}

describe('AccountPage', () => {
  beforeEach(() => {
    api.getMyProfile.mockResolvedValue(profile)
    api.setDisplayName.mockResolvedValue(undefined)
    api.setEmailNotifications.mockResolvedValue(undefined)
  })
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('saves a new name, trimmed', async () => {
    renderPage()
    const field = await screen.findByLabelText('Name')
    const save = screen.getByRole('button', { name: 'Save name' }) as HTMLButtonElement
    expect(save.disabled).toBe(true)

    fireEvent.change(field, { target: { value: '  Robert  ' } })
    fireEvent.click(save)
    await waitFor(() => expect(api.setDisplayName).toHaveBeenCalledWith('Robert'))
    expect(await screen.findByText('Name saved.')).toBeTruthy()
  })

  it('switches notification emails off', async () => {
    renderPage()
    const toggle = (await screen.findByRole('switch', { name: /Email me/ })) as HTMLInputElement
    expect(toggle.checked).toBe(true)
    fireEvent.click(toggle)
    await waitFor(() => expect(api.setEmailNotifications).toHaveBeenCalledWith(false))
  })

  it('shows an error if the download fails', async () => {
    api.exportMyData.mockRejectedValue(new Error('Your session has ended. Please sign in again.'))
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Download my data' }))
    expect(await screen.findByText('Your session has ended. Please sign in again.')).toBeTruthy()
  })

  it('names the download by NZ date', () => {
    // 11:30pm UTC on 1 Nov is already 2 Nov in New Zealand.
    expect(exportFileName(new Date('2026-11-01T23:30:00Z'))).toBe('kinvo-data-2026-11-02.json')
  })

  it('has no accessibility problems', async () => {
    const { container } = renderPage()
    await screen.findByLabelText('Name')
    await expectNoAxeViolations(container)
  })
})
