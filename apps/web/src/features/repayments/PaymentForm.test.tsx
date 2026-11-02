// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { todayInNZ } from '../../domain/dates'
import { toCents } from '../../domain/money'
import { expectNoAxeViolations } from '../../test/axe'
import { PaymentForm } from './PaymentForm'

const recordRepayment = vi.hoisted(() => vi.fn())
vi.mock('../../data/repayments', () => ({ recordRepayment }))
vi.mock('../../data/images', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../data/images')>()),
  cleanImage: vi.fn(async () => new Blob(['jpeg'], { type: 'image/jpeg' })),
  uploadReceipt: vi.fn(async () => 'loan-1/receipt.jpg'),
}))
URL.createObjectURL = vi.fn(() => 'blob:receipt')
URL.revokeObjectURL = vi.fn()

const today = todayInNZ()

function renderForm(onRecorded = vi.fn()) {
  render(
    <PaymentForm
      loanId="loan-1"
      isLender
      lenderName="Lena"
      outstandingCents={toCents(15000)}
      suggestedCents={toCents(5000)}
      earliestDate="2026-01-01"
      onRecorded={onRecorded}
    />,
  )
  return onRecorded
}

describe('PaymentForm', () => {
  beforeEach(() => recordRepayment.mockReset().mockResolvedValue(undefined))
  afterEach(cleanup)

  it('asks the amount, then how and when, then the receipt, and records it', async () => {
    const onRecorded = renderForm()
    expect((screen.getByLabelText('Amount') as HTMLInputElement).value).toBe('50')
    await userEvent.click(screen.getByRole('button', { name: /all of it \$150\.00/i }))
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))

    expect(screen.getByText('Step 2 of 3')).toBeTruthy()
    await userEvent.click(screen.getByRole('radio', { name: 'Cash' }))
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))

    // The receipt is required.
    expect(screen.getByRole('heading', { name: 'Add the receipt' })).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Record payment' }))
    expect(screen.getByText(/add a photo of the receipt/i)).toBeTruthy()
    expect(recordRepayment).not.toHaveBeenCalled()

    await userEvent.upload(
      screen.getByLabelText('Choose photo'),
      new File(['img'], 'receipt.png', { type: 'image/png' }),
    )
    expect(await screen.findByRole('img', { name: 'Receipt you added' })).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Record payment' }))

    expect(recordRepayment).toHaveBeenCalledWith(
      'loan-1',
      expect.objectContaining({
        amountCents: 15000,
        receivedOn: today,
        method: 'cash',
        receiptPath: 'loan-1/receipt.jpg',
      }),
    )
    expect(onRecorded).toHaveBeenCalled()
  })

  it('refuses a payment larger than what is owed', async () => {
    renderForm()
    const amount = screen.getByLabelText('Amount')
    await userEvent.clear(amount)
    await userEvent.type(amount, '200')
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(screen.getByText(/most you can record is \$150\.00/i)).toBeTruthy()
    expect(screen.getByText('Step 1 of 3')).toBeTruthy()
  })

  it('has no accessibility problems', async () => {
    renderForm()
    await expectNoAxeViolations(document.body)
  })
})
