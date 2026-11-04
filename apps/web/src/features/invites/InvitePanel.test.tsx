// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { addDays, todayInNZ } from '../../domain/dates'
import { InvitePanel } from './InvitePanel'
import { expectNoAxeViolations } from '../../test/axe'

const api = vi.hoisted(() => ({
  createInvite: vi.fn(),
  listOpenInvites: vi.fn(),
  revokeInvite: vi.fn(),
}))
vi.mock('../../data/invites', () => api)

const today = todayInNZ()

describe('InvitePanel', () => {
  beforeEach(() => {
    api.listOpenInvites.mockResolvedValue([])
    api.createInvite.mockReset().mockResolvedValue({ id: 'i1', url: 'https://kinvo.test/invite/abc', expiresAt: '' })
  })
  afterEach(cleanup)

  it('creates a plain invite', async () => {
    render(<InvitePanel />)
    await userEvent.type(screen.getByLabelText(/who is it for/i), 'Cousin Sam')
    await userEvent.click(screen.getByRole('button', { name: /create invite link/i }))
    expect(api.createInvite).toHaveBeenCalledWith('Cousin Sam')
    expect(await screen.findByText('https://kinvo.test/invite/abc')).toBeTruthy()
  })

  it('attaches an existing debt with its repayment plan', async () => {
    render(<InvitePanel />)
    await userEvent.click(screen.getByLabelText(/they already owe me money/i))

    const lentOn = addDays(today, -60)
    await userEvent.type(screen.getByLabelText(/amount they owe you now/i), '300')
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
    // No charge step for an existing debt: straight to the plan.
    expect(screen.queryByLabelText(/one-off charge/i)).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'More payments' }))
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await userEvent.type(screen.getByLabelText(/owed since/i), lentOn)
    await userEvent.type(screen.getByLabelText(/what for/i), 'Car rego')
    await userEvent.click(screen.getByRole('button', { name: /create invite link/i }))

    expect(api.createInvite).toHaveBeenCalledWith(
      '',
      expect.objectContaining({
        amountCents: 30000,
        lentOn,
        reason: 'Car rego',
        instalments: [
          { dueOn: addDays(today, 7), amountCents: 15000 },
          { dueOn: addDays(today, 14), amountCents: 15000 },
        ],
      }),
    )
  })

  it('asks when the money was lent', async () => {
    render(<InvitePanel />)
    await userEvent.click(screen.getByLabelText(/they already owe me money/i))
    await userEvent.type(screen.getByLabelText(/amount they owe you now/i), '300')
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await userEvent.click(screen.getByRole('button', { name: /create invite link/i }))
    expect(api.createInvite).not.toHaveBeenCalled()
    expect(await screen.findByText(/when this started/i)).toBeTruthy()
  })

  it('has no accessibility problems, including the existing-debt form', async () => {
    const { container } = render(<InvitePanel />)
    await userEvent.click(screen.getByRole('checkbox'))
    await expectNoAxeViolations(container)
  })
})
