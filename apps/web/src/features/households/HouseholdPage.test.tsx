// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { addDays, todayInNZ } from '../../domain/dates'
import type { HouseholdDetail } from '../../data/households'
import { expectNoAxeViolations } from '../../test/axe'
import { HouseholdPage } from './HouseholdPage'

const today = todayInNZ()
const household = {
  id: 'h1',
  name: 'Our place',
  hasSharedAccount: true,
  sharedAccountName: 'Joint Co-op',
  members: [
    { userId: 'me', name: 'Ethan Grey', photo: null, role: 'owner', shareBp: null },
    { userId: 'hana', name: 'Hana Grey', photo: null, role: 'member', shareBp: null },
  ],
  topups: [{ id: 't1', memberId: 'hana', amountCents: 35000, frequency: 'weekly', nextOn: addDays(today, 7) }],
  bills: [
    {
      id: 'rent',
      name: 'Rent',
      category: 'rent',
      amountType: 'fixed',
      amountCents: 60000,
      frequency: 'weekly',
      nextDueOn: addDays(today, 9),
      method: 'shared_account',
      payerId: null,
      split: null,
    },
    {
      id: 'power',
      name: 'Power',
      category: 'power',
      amountType: 'varies',
      amountCents: null,
      frequency: 'monthly',
      nextDueOn: null,
      method: 'one_person',
      payerId: 'me',
      split: null,
    },
  ],
  occurrences: [
    {
      id: 'o1',
      billId: 'rent',
      dueOn: addDays(today, 2),
      method: 'shared_account',
      payerId: null,
      amountCents: 60000,
      status: 'open',
      receiptPath: null,
      shares: [],
    },
    {
      id: 'o2',
      billId: 'power',
      dueOn: addDays(today, 3),
      method: 'one_person',
      payerId: 'me',
      amountCents: null,
      status: 'needs_amount',
      receiptPath: null,
      shares: [],
    },
  ],
  sharedEntries: [
    {
      id: 'e1',
      kind: 'opening',
      amountCents: 50000,
      memberId: null,
      occurrenceId: null,
      note: null,
      occurredOn: today,
      createdBy: 'me',
      voided: false,
    },
    {
      id: 'e2',
      kind: 'bill',
      amountCents: -60000,
      memberId: null,
      occurrenceId: 'o1',
      note: 'Rent',
      occurredOn: addDays(today, 2),
      createdBy: null,
      voided: false,
    },
  ],
  tab: [
    {
      id: 'x1',
      owedTo: 'hana',
      owedBy: 'me',
      amountCents: 4250,
      source: 'bill',
      occurrenceId: null,
      note: 'Power',
      createdBy: null,
      createdAt: today,
      voided: false,
    },
  ],
} as unknown as HouseholdDetail

vi.mock('../../data/households', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../data/households')>()),
  getHousehold: () => Promise.resolve(household),
  createHouseholdInvite: vi.fn(() => Promise.resolve('tok')),
}))
vi.mock('../auth/useAuth', () => ({ useAuth: () => ({ session: { user: { id: 'me' } } }) }))

afterEach(cleanup)

describe('HouseholdPage', () => {
  it('shows what needs doing, who owes who, the shared account and bills', async () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/households/h1']}>
        <Routes>
          <Route path="/households/:id" element={<HouseholdPage />} />
        </Routes>
      </MemoryRouter>,
    )
    await screen.findByRole('heading', { name: 'Our place' })
    await expectNoAxeViolations(container)

    expect(screen.getByText('Power: enter the amount')).toBeTruthy()
    expect(screen.getByText('You owe Hana')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Settle up' }).getAttribute('href')).toBe('/households/h1/settle/hana')
    expect(screen.getByText('$500.00')).toBeTruthy()
    expect(screen.getByText(/could be \$100\.00 short/)).toBeTruthy()
    expect(screen.getByText('Hana: $350.00 every week')).toBeTruthy()
    expect(screen.getByText('Amount needed')).toBeTruthy()

    Object.assign(navigator, { clipboard: { writeText: vi.fn(() => Promise.resolve()) } })
    await userEvent.click(screen.getByRole('button', { name: 'Invite someone' }))
    await waitFor(() => expect(screen.getByText(/household-invite\/tok/)).toBeTruthy())
  })
})
