// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { addDays, todayInNZ } from '../../domain/dates'
import { toCents } from '../../domain/money'
import { TermsForm } from './TermsForm'
import { expectNoAxeViolations } from '../../test/axe'

afterEach(cleanup)

const today = todayInNZ()
const week1 = addDays(today, 7)
const week2 = addDays(today, 14)

function renderForm(onSubmit = vi.fn().mockResolvedValue(undefined)) {
  render(<TermsForm submitLabel="Send request" messageLabel="Message" onSubmit={onSubmit} />)
  return onSubmit
}

async function fillAmounts(principal: string, charge: string) {
  await userEvent.type(screen.getByLabelText(/amount to borrow/i), principal)
  const chargeInput = screen.getByLabelText(/one-off charge/i)
  await userEvent.clear(chargeInput)
  await userEvent.type(chargeInput, charge)
}

describe('TermsForm', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('builds the brief’s example: borrow $200, $100 charge, two weekly payments of $150', async () => {
    const onSubmit = renderForm()
    await fillAmounts('200', '100')
    await userEvent.selectOptions(screen.getByLabelText(/^payments$/i), '2')

    expect(screen.getByText('$300.00')).toBeTruthy()
    expect(screen.getByText(/50% of the amount borrowed/i)).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: /send request/i }))

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        principalCents: 20000,
        chargeCents: 10000,
        instalments: [
          { dueOn: week1, amountCents: 15000 },
          { dueOn: week2, amountCents: 15000 },
        ],
      }),
    )
  })

  it('switches to manual mode when a payment is edited, and blocks a mismatched total', async () => {
    const onSubmit = renderForm()
    await fillAmounts('200', '0')

    const amount = screen.getAllByLabelText(/amount \(\$\)/i)[0]
    if (!amount) throw new Error('amount field missing')
    await userEvent.clear(amount)
    await userEvent.type(amount, '150')

    expect(screen.getByText(/editing payments by hand/i)).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: /send request/i }))

    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByText(/add up to \$150\.00 but should total \$200\.00/i)).toBeTruthy()
  })

  it('requires an amount', async () => {
    const onSubmit = renderForm()
    await userEvent.click(screen.getByRole('button', { name: /send request/i }))
    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByText(/enter the amount to borrow/i)).toBeTruthy()
  })

  it('pre-fills a counter-offer from existing terms', () => {
    render(
      <TermsForm
        initial={{
          principalCents: toCents(20000),
          chargeCents: toCents(2000),
          instalments: [{ dueOn: week1, amountCents: toCents(22000) }],
          lateTerms: 'Tell me early',
          conditions: '',
          message: '',
        }}
        submitLabel="Send"
        messageLabel="Message"
        onSubmit={vi.fn()}
      />,
    )
    expect((screen.getByLabelText(/amount to borrow/i) as HTMLInputElement).value).toBe('200')
    expect((screen.getByLabelText(/one-off charge/i) as HTMLInputElement).value).toBe('20')
    expect(screen.getByDisplayValue('Tell me early')).toBeTruthy()
  })

  it('shows server errors from the submit handler', async () => {
    renderForm(vi.fn().mockRejectedValue(new Error('The terms changed while you were looking.')))
    await fillAmounts('50', '0')
    fireEvent.submit(screen.getByRole('button', { name: /send request/i }).closest('form') as HTMLFormElement)
    expect(await screen.findByText(/terms changed while you were looking/i)).toBeTruthy()
  })

  it('has no accessibility problems', async () => {
    renderForm()
    await expectNoAxeViolations(document.body)
  })
})
