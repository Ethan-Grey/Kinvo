// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { addDays, todayInNZ } from '../../domain/dates'
import { expectNoAxeViolations } from '../../test/axe'
import { SplitBillPage } from './SplitBillPage'

const bills = vi.hoisted(() => ({ createSplitBill: vi.fn(() => Promise.resolve(['l1', 'l2'])) }))
vi.mock('../../data/bills', () => bills)
vi.mock('../../data/people', () => ({
  listPeople: () =>
    Promise.resolve({
      lenders: [],
      borrowers: [
        { relationshipId: 'r-hana', personName: 'Hana Grey', personPhoto: null },
        { relationshipId: 'r-sam', personName: 'Sam Flat', personPhoto: null },
      ],
    }),
}))
const jpeg = new Blob(['x'], { type: 'image/jpeg' })
vi.mock('../../data/images', () => ({
  cleanImage: () => Promise.resolve(jpeg),
  uploadReceipt: vi.fn(),
  imageFromClipboard: () => Promise.resolve(null),
  ReceiptError: class extends Error {},
}))
vi.mock('../auth/useAuth', () => ({ useAuth: () => ({ session: { user: { id: 'me' } } }) }))
URL.createObjectURL = () => 'blob:preview'
URL.revokeObjectURL = () => {}

afterEach(() => {
  cleanup()
  bills.createSplitBill.mockClear()
})

async function next() {
  await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
}

describe('SplitBillPage', () => {
  it('splits a bill evenly with two people, keeping my share', async () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/bills/new']}>
        <Routes>
          <Route path="/bills/new" element={<SplitBillPage />} />
          <Route path="/loans" element={<p>Owed page</p>} />
        </Routes>
      </MemoryRouter>,
    )
    await screen.findByRole('heading', { name: 'What did you pay for?' })
    await expectNoAxeViolations(container)

    await next()
    expect(screen.getByText('Say what it was for, e.g. Groceries.')).toBeTruthy()
    await userEvent.type(screen.getByLabelText('What it was for'), 'Groceries')
    await userEvent.type(screen.getByLabelText('Bill total'), '120')
    await next()

    await userEvent.upload(screen.getByLabelText('Choose photo'), new File(['x'], 'r.jpg', { type: 'image/jpeg' }))
    await screen.findByAltText('Receipt you added')
    await next()

    await userEvent.click(screen.getByRole('button', { name: 'Hana Grey' }))
    await userEvent.click(screen.getByRole('button', { name: 'Sam Flat' }))
    await next()
    expect(screen.getAllByText('$40.00')).toHaveLength(3) // Hana, Sam and me

    await userEvent.click(screen.getByRole('radio', { name: 'By amount' }))
    await userEvent.type(screen.getByLabelText('Hana’s share ($)'), '50')
    await userEvent.type(screen.getByLabelText('Sam’s share ($)'), '30')
    await next()
    await next()
    await userEvent.click(screen.getByRole('button', { name: 'Send to Hana and Sam' }))

    await waitFor(() =>
      expect(bills.createSplitBill).toHaveBeenCalledWith({
        description: 'Groceries',
        totalCents: 12000,
        paidOn: todayInNZ(),
        dueOn: addDays(todayInNZ(), 7),
        shares: [
          { relationshipId: 'r-hana', amountCents: 5000 },
          { relationshipId: 'r-sam', amountCents: 3000 },
        ],
        receipt: jpeg,
      }),
    )
    expect(await screen.findByText('Owed page')).toBeTruthy()
  })
})
