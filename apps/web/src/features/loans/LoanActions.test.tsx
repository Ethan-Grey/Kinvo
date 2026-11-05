// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { toCents } from '../../domain/money'
import type { LoanDetail } from '../../data/loans'
import { expectNoAxeViolations } from '../../test/axe'
import { LoanActions } from './LoanActions'

const api = vi.hoisted(() => ({
  rejectTerms: vi.fn(() => Promise.resolve()),
  withdrawLoan: vi.fn(() => Promise.resolve()),
}))
vi.mock('../../data/loans', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../data/loans')>()),
  ...api,
}))
HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
  this.setAttribute('open', '')
}
HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
  this.removeAttribute('open')
}

afterEach(cleanup)

const loan = (over: Partial<LoanDetail>) =>
  ({
    id: 'l1',
    kind: 'new',
    status: 'negotiating',
    role: 'lender',
    lenderId: 'me',
    borrowerId: 'hana',
    lenderName: 'Ethan Grey',
    borrowerName: 'Hana Grey',
    currentTerms: { proposedBy: 'hana', principalCents: toCents(20000) },
    ...over,
  }) as unknown as LoanDetail

function renderActions(l: LoanDetail, onChanged = vi.fn()) {
  render(
    <MemoryRouter initialEntries={['/loans/l1']}>
      <Routes>
        <Route path="/loans/l1" element={<LoanActions loan={l} userId="me" onChanged={onChanged} />} />
        <Route path="/loans/l1/change" element={<h1>Change page</h1>} />
      </Routes>
    </MemoryRouter>,
  )
  return onChanged
}

describe('LoanActions', () => {
  it('shows only Accept and Decline for a request', async () => {
    renderActions(loan({}))
    expect(screen.getByRole('link', { name: 'Accept' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Decline' })).toBeTruthy()
    expect(screen.queryByText(/suggest changes/i)).toBeNull()
    await expectNoAxeViolations(document.body)
  })

  it('asks whether to make changes or remove the request when declining', async () => {
    const onChanged = renderActions(loan({}))
    await userEvent.click(screen.getByRole('button', { name: 'Decline' }))
    expect(screen.getByRole('heading', { name: 'Decline this?' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /make changes/i })).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: /remove this request/i }))
    expect(api.rejectTerms).toHaveBeenCalledWith('l1', '')
    expect(onChanged).toHaveBeenCalled()
  })

  it('opens the change page from the sheet', async () => {
    renderActions(loan({ role: 'borrower' }))
    await userEvent.click(screen.getByRole('button', { name: 'Decline' }))
    await userEvent.click(screen.getByRole('button', { name: /make changes/i }))
    expect(await screen.findByRole('heading', { name: 'Change page' })).toBeTruthy()
  })

  it('has paid-out and cancel once agreed', async () => {
    renderActions(loan({ status: 'agreed' }))
    expect(screen.getByRole('link', { name: /i’ve paid it out/i })).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await userEvent.click(screen.getByRole('button', { name: /cancel it/i }))
    expect(api.withdrawLoan).toHaveBeenCalledWith('l1', '')
  })
})
