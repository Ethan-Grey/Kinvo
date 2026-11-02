// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { todayInNZ } from '../../domain/dates'
import { toCents } from '../../domain/money'
import type { LoanDetail } from '../../data/loans'
import type { InstalmentProgress, LoanBalance, Repayment } from '../../data/repayments'
import { RepaymentsPanel } from './RepaymentsPanel'
import { expectNoAxeViolations } from '../../test/axe'

const api = vi.hoisted(() => ({
  getBalance: vi.fn(),
  getInstalmentProgress: vi.fn(),
  listRepayments: vi.fn(),
  recordRepayment: vi.fn(),
  confirmRepayment: vi.fn(),
  disputeRepayment: vi.fn(),
  reverseRepayment: vi.fn(),
  forgiveRemaining: vi.fn(),
}))
vi.mock('../../data/repayments', () => api)

const today = todayInNZ()

const loan = {
  id: 'loan-1',
  status: 'active',
  role: 'lender',
  lenderId: 'lena',
  borrowerId: 'bob',
  lenderName: 'Lena',
  borrowerName: 'Bob',
  fundsSentOn: '2026-10-01',
  currentTerms: { principalCents: toCents(20000) },
} as unknown as LoanDetail

const balance: LoanBalance = {
  totalCents: toCents(30000),
  paidCents: toCents(15000),
  writtenOffCents: toCents(0),
  outstandingCents: toCents(15000),
  nextDueOn: '2026-10-20',
  nextDueCents: toCents(15000),
  overdueCents: toCents(15000),
  overdueCount: 1,
}

const progress: InstalmentProgress[] = [
  {
    sequence: 1,
    dueOn: '2026-10-13',
    amountCents: toCents(15000),
    paidCents: toCents(15000),
    remainingCents: toCents(0),
    paidOn: '2026-10-12',
    status: 'paid',
  },
  {
    sequence: 2,
    dueOn: '2026-10-20',
    amountCents: toCents(15000),
    paidCents: toCents(0),
    remainingCents: toCents(15000),
    paidOn: null,
    status: 'overdue',
  },
]

const claim: Repayment = {
  id: 'r-claim',
  amountCents: toCents(5000),
  receivedOn: today,
  method: 'bank_transfer',
  reference: 'BOB-2',
  notes: null,
  status: 'claimed',
  submittedBy: 'bob',
  createdAt: new Date().toISOString(),
  disputeReason: null,
  reversalReason: null,
}

function renderPanel(role: 'lender' | 'borrower' = 'lender') {
  return render(
    <MemoryRouter>
      <RepaymentsPanel loan={{ ...loan, role }} userId={role === 'lender' ? 'lena' : 'bob'} onLoanChanged={vi.fn()} />
    </MemoryRouter>,
  )
}

describe('RepaymentsPanel', () => {
  beforeEach(() => {
    Object.values(api).forEach((fn) => fn.mockReset())
    api.getBalance.mockResolvedValue(balance)
    api.getInstalmentProgress.mockResolvedValue(progress)
    api.listRepayments.mockResolvedValue([claim])
    api.recordRepayment.mockResolvedValue(undefined)
    api.confirmRepayment.mockResolvedValue(undefined)
  })
  afterEach(cleanup)

  it('shows the balance, overdue amount and schedule status', async () => {
    renderPanel()
    expect(await screen.findByText(/paid \$150\.00 of \$300\.00/i)).toBeTruthy()
    expect(screen.getByText(/\$150\.00 is overdue/i)).toBeTruthy()
    expect(screen.getAllByText('Overdue').length).toBeGreaterThan(0)
    expect(screen.getByText('Paid')).toBeTruthy()
  })

  it('lets the lender confirm a borrower’s claim', async () => {
    renderPanel()
    await userEvent.click(await screen.findByRole('button', { name: /i received it/i }))
    expect(api.confirmRepayment).toHaveBeenCalledWith('r-claim')
  })

  it('shows the borrower their claim is waiting, without lender buttons', async () => {
    renderPanel('borrower')
    expect(await screen.findByText(/waiting for confirmation/i)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /i received it/i })).toBeNull()
    expect(screen.getByRole('button', { name: /tell them i’ve paid/i })).toBeTruthy()
  })

  it('pre-fills the next amount due and records a lender payment', async () => {
    renderPanel()
    const amount = (await screen.findByLabelText(/^amount/i)) as HTMLInputElement
    expect(amount.value).toBe('150')
    await userEvent.click(screen.getByRole('button', { name: /record payment/i }))
    expect(api.recordRepayment).toHaveBeenCalledWith(
      'loan-1',
      expect.objectContaining({ amountCents: 15000, receivedOn: today, method: 'bank_transfer' }),
    )
  })

  it('refuses a payment larger than what is owed', async () => {
    renderPanel()
    const amount = await screen.findByLabelText(/^amount/i)
    await userEvent.clear(amount)
    await userEvent.type(amount, '200')
    await userEvent.click(screen.getByRole('button', { name: /record payment/i }))
    expect(api.recordRepayment).not.toHaveBeenCalled()
    expect(screen.getByText(/most you can record is \$150\.00/i)).toBeTruthy()
  })

  it('has no accessibility problems', async () => {
    const { container } = renderPanel()
    await screen.findByText(/paid \$150\.00 of \$300\.00/i)
    await expectNoAxeViolations(container)
  })
})
