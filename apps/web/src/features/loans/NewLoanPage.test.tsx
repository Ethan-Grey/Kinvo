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
  it('asks how much first, then what it’s for, when asking to borrow', async () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/loans/new?as=borrower']}>
        <Routes>
          <Route path="/loans/new" element={<NewLoanPage />} />
        </Routes>
      </MemoryRouter>,
    )
    await screen.findByRole('heading', { name: 'How much do you need?' })
    expect(screen.getByRole('heading', { name: 'Ask Hana for money' })).toBeTruthy()
    await expectNoAxeViolations(container)

    await userEvent.type(screen.getByLabelText(/^amount$/i), '200')
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByRole('heading', { name: 'What do you need it for?' })).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(screen.getByText('Say what it’s for.')).toBeTruthy()

    await userEvent.type(screen.getByLabelText('What it’s for'), 'Car repairs')
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByRole('heading', { name: 'How will it be paid back?' })).toBeTruthy()

    // Back keeps the reason.
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect((screen.getByLabelText('What it’s for') as HTMLTextAreaElement).value).toBe('Car repairs')
  })
})
