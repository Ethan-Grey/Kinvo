// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { expectNoAxeViolations } from '../../test/axe'
import { NewLoanPage } from './NewLoanPage'

vi.mock('../../data/people', () => ({
  listPeople: () =>
    Promise.resolve({ lenders: [{ relationshipId: 'r1', personName: 'Hana Grey', personPhoto: null }], borrowers: [] }),
}))
vi.mock('../../data/loans', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../data/loans')>()),
  createLoan: vi.fn(() => Promise.resolve('l1')),
}))
vi.mock('../auth/useAuth', () => ({ useAuth: () => ({ session: { user: { id: 'me' } } }) }))

afterEach(cleanup)

describe('NewLoanPage', () => {
  it('asks what it’s for before anything else when asking to borrow', async () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/loans/new?as=borrower']}>
        <Routes>
          <Route path="/loans/new" element={<NewLoanPage />} />
        </Routes>
      </MemoryRouter>,
    )
    await screen.findByRole('heading', { name: 'What do you need it for?' })
    await expectNoAxeViolations(container)

    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(screen.getByText('Tell Hana what it’s for.')).toBeTruthy()

    await userEvent.type(screen.getByLabelText('What it’s for'), 'Car repairs')
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByRole('heading', { name: 'How much will you owe?' })).toBeTruthy()

    // Back from the amount goes back to the reason, still filled in.
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect((screen.getByLabelText('What it’s for') as HTMLTextAreaElement).value).toBe('Car repairs')
  })
})
