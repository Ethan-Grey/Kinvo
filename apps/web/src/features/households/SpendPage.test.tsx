// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { todayInNZ } from '../../domain/dates'
import type { HouseholdDetail } from '../../data/households'
import { expectNoAxeViolations } from '../../test/axe'
import { SpendForm } from './SpendPage'

const api = vi.hoisted(() => ({ addExpense: vi.fn(() => Promise.resolve('x1')) }))
vi.mock('../../data/households', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../data/households')>()),
  ...api,
}))

const h = {
  id: 'h1',
  name: 'Our place',
  hasSharedAccount: true,
  sharedAccountName: 'Joint Co-op',
  members: [
    { userId: 'me', name: 'Ethan Grey', photo: null, role: 'owner', shareBp: null },
    { userId: 'hana', name: 'Hana Grey', photo: null, role: 'member', shareBp: null },
  ],
} as unknown as HouseholdDetail

afterEach(cleanup)

function renderForm() {
  return render(
    <MemoryRouter initialEntries={['/households/h1/spend']}>
      <Routes>
        <Route path="/households/h1/spend" element={<SpendForm h={h} me="me" />} />
        <Route path="/households/h1" element={<p>Household page</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('SpendForm', () => {
  it('adds groceries I paid for, split evenly', async () => {
    const { container } = renderForm()
    await expectNoAxeViolations(container)
    await userEvent.type(screen.getByLabelText('How much'), '84.20')
    await userEvent.type(screen.getByLabelText('Note (optional)'), 'Pak’nSave')
    await userEvent.click(screen.getByRole('button', { name: 'Add' }))
    await waitFor(() =>
      expect(api.addExpense).toHaveBeenCalledWith('h1', {
        category: 'groceries',
        amountCents: 8420,
        paidBy: 'me',
        description: 'Pak’nSave',
        spentOn: todayInNZ(),
        split: null,
        receipt: null,
      }),
    )
    expect(await screen.findByText('Household page')).toBeTruthy()
  })

  it('can come from the shared account, or be all for one person', async () => {
    renderForm()
    await userEvent.type(screen.getByLabelText('How much'), '30')
    await userEvent.click(screen.getByRole('button', { name: 'Takeaways' }))
    await userEvent.click(screen.getByRole('radio', { name: 'Custom' }))
    await userEvent.click(screen.getByRole('button', { name: /all.*hana/i }))
    await userEvent.click(screen.getByRole('button', { name: 'Add' }))
    await waitFor(() =>
      expect(api.addExpense).toHaveBeenLastCalledWith(
        'h1',
        expect.objectContaining({
          category: 'takeaways',
          split: [
            { userId: 'me', shareBp: 0 },
            { userId: 'hana', shareBp: 10000 },
          ],
        }),
      ),
    )
  })
})
