// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { toCents } from '../../domain/money'
import type { LoanDetail } from '../../data/loans'
import type { InstalmentProgress } from '../../data/repayments'
import { expectNoAxeViolations } from '../../test/axe'
import { ScheduleEditor } from './ChangeSchedulePage'

const api = vi.hoisted(() => ({ rescheduleLoan: vi.fn(() => Promise.resolve()) }))
vi.mock('../../data/loans', () => api)

const loan = {
  id: 'loan-1',
  status: 'active',
  role: 'lender',
  borrowerName: 'Bob Borrower',
  currentTerms: {
    id: 'terms-1',
    totalCents: toCents(30000),
    instalments: [
      { dueOn: '2026-11-01', amountCents: toCents(10000) },
      { dueOn: '2026-11-15', amountCents: toCents(10000) },
      { dueOn: '2026-11-29', amountCents: toCents(10000) },
    ],
  },
} as unknown as LoanDetail

const progress: InstalmentProgress[] = [
  {
    sequence: 1,
    dueOn: '2026-11-01',
    amountCents: toCents(10000),
    paidCents: toCents(10000),
    remainingCents: toCents(0),
    paidOn: '2026-11-01',
    status: 'paid',
  },
  {
    sequence: 2,
    dueOn: '2026-11-15',
    amountCents: toCents(10000),
    paidCents: toCents(2500),
    remainingCents: toCents(7500),
    paidOn: null,
    status: 'due',
  },
  {
    sequence: 3,
    dueOn: '2026-11-29',
    amountCents: toCents(10000),
    paidCents: toCents(0),
    remainingCents: toCents(10000),
    paidOn: null,
    status: 'due',
  },
]

afterEach(() => {
  cleanup()
  api.rescheduleLoan.mockClear()
})

describe('ScheduleEditor', () => {
  it('keeps paid payments, moves the rest and saves', async () => {
    const onDone = vi.fn()
    const { container } = render(<ScheduleEditor loan={loan} progress={progress} onDone={onDone} />)
    await expectNoAxeViolations(container)

    expect(screen.getAllByLabelText('Due')).toHaveLength(2) // the paid one isn't editable
    expect(screen.getByText('$25.00 already paid towards this.')).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: '2 weeks later' }))
    await userEvent.type(screen.getByLabelText('Note to Bob (optional)'), 'New pay day')
    await userEvent.click(screen.getByRole('button', { name: 'Save new schedule' }))

    expect(api.rescheduleLoan).toHaveBeenCalledWith(
      'loan-1',
      'terms-1',
      [
        { dueOn: '2026-11-01', amountCents: 10000 },
        { dueOn: '2026-11-29', amountCents: 10000 },
        { dueOn: '2026-12-13', amountCents: 10000 },
      ],
      'New pay day',
    )
    expect(onDone).toHaveBeenCalledWith('Schedule changed. Bob has been told.')
  })

  it('won’t save a schedule that doesn’t add up', async () => {
    render(<ScheduleEditor loan={loan} progress={progress} onDone={vi.fn()} />)
    const amounts = screen.getAllByLabelText('Amount ($)')
    const second = amounts[1] as HTMLInputElement
    await userEvent.clear(second)
    await userEvent.type(second, '50')
    await userEvent.click(screen.getByRole('button', { name: 'Save new schedule' }))

    expect(screen.getByText('The payments must add up to the total owed.')).toBeTruthy()
    expect(api.rescheduleLoan).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Split $200.00 evenly' }))
    expect(amounts.map((a) => (a as HTMLInputElement).value)).toEqual(['100', '100'])
  })
})
