// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RepeatingDebt } from '../../data/repeating'
import { expectNoAxeViolations } from '../../test/axe'
import { RepeatingPage } from './RepeatingPage'

const debt: RepeatingDebt = {
  id: 'rep-1',
  relationshipId: 'rel-1',
  role: 'borrower',
  otherPersonName: 'Ethan Grey',
  otherPersonPhoto: null,
  description: 'Rent',
  amountCents: 15000 as RepeatingDebt['amountCents'],
  frequency: 'weekly',
  firstOn: '2026-11-09',
  endOn: null,
  status: 'proposed',
  nextOn: null,
}
const api = vi.hoisted(() => ({
  getRepeating: vi.fn(),
  respondRepeating: vi.fn(() => Promise.resolve()),
  changeRepeatingAmount: vi.fn(() => Promise.resolve()),
  setRepeatingStatus: vi.fn(() => Promise.resolve()),
}))
vi.mock('../../data/repeating', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../data/repeating')>()),
  ...api,
}))
vi.mock('../../data/loans', () => ({ listLoans: () => Promise.resolve([]) }))
vi.mock('../auth/useAuth', () => ({ useAuth: () => ({ session: { user: { id: 'me' } } }) }))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/repeating/rep-1']}>
      <Routes>
        <Route path="/repeating/:id" element={<RepeatingPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('RepeatingPage', () => {
  it('lets the person who owes accept it once', async () => {
    api.getRepeating.mockResolvedValue(debt)
    const { container } = renderPage()
    await screen.findByRole('heading', { name: 'Rent' })
    expect(screen.getByText('$150.00')).toBeTruthy()
    expect(screen.getByText(/Every week, from/)).toBeTruthy()
    await expectNoAxeViolations(container)

    await userEvent.click(screen.getByRole('button', { name: 'Accept' }))
    await waitFor(() => expect(api.respondRepeating).toHaveBeenCalledWith('rep-1', true))
  })

  it('lets the person owed change the amount and pause it', async () => {
    api.getRepeating.mockResolvedValue({ ...debt, role: 'lender', status: 'active', nextOn: '2026-11-16' })
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: 'Change the amount' }))
    await userEvent.type(screen.getByLabelText('New amount ($)'), '175')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(api.changeRepeatingAmount).toHaveBeenCalledWith('rep-1', 17500))

    await userEvent.click(screen.getByRole('button', { name: 'Pause' }))
    await waitFor(() => expect(api.setRepeatingStatus).toHaveBeenCalledWith('rep-1', 'paused'))
    expect(screen.queryByRole('button', { name: 'Accept' })).toBeNull()
  })
})
