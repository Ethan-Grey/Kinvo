// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { addDays, todayInNZ } from '../../domain/dates'
import { toCents } from '../../domain/money'
import { expectNoAxeViolations } from '../../test/axe'
import { TermsForm } from './TermsForm'

afterEach(cleanup)

const today = todayInNZ()
const week1 = addDays(today, 7)
const week2 = addDays(today, 14)

function renderForm(onSubmit = vi.fn().mockResolvedValue(undefined)) {
  render(<TermsForm submitLabel="Send request" messageLabel="Message" onSubmit={onSubmit} />)
  return onSubmit
}

const next = () => userEvent.click(screen.getByRole('button', { name: 'Continue' }))

/** Step 1: how much. Step 2: charge. Leaves the form on step 3 (the plan). */
async function enterAmounts(principal: string, charge: string) {
  await userEvent.type(screen.getByLabelText(/^amount$/i), principal)
  await next()
  const chargeInput = screen.getByLabelText(/one-off charge/i)
  await userEvent.clear(chargeInput)
  await userEvent.type(chargeInput, charge)
  await next()
}

describe('TermsForm', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('asks one thing per step and builds the brief’s example: $200 + $100, two weekly payments', async () => {
    const onSubmit = renderForm()
    expect(screen.getByText('Step 1 of 4')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'How much will you owe?' })).toBeTruthy()

    await userEvent.type(screen.getByLabelText(/^amount$/i), '200')
    await next()
    expect(screen.getByRole('heading', { name: 'Is there a charge?' })).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: '50%' }))
    expect(screen.getByText(/50% of the amount$/i)).toBeTruthy()
    expect(screen.getByText('$300.00')).toBeTruthy()
    await next()

    expect(screen.getByRole('heading', { name: 'How will it be paid back?' })).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'More payments' }))
    await next()

    expect(screen.getByRole('heading', { name: 'Check and send' })).toBeTruthy()
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

  it('won’t move on without an amount', async () => {
    renderForm()
    await next()
    expect(screen.getByText(/enter the amount\./i)).toBeTruthy()
    expect(screen.getByText('Step 1 of 4')).toBeTruthy()
  })

  it('lets payments be edited by hand, and blocks a mismatched total', async () => {
    renderForm()
    await enterAmounts('200', '0')
    await userEvent.click(screen.getByRole('button', { name: /change dates or amounts by hand/i }))

    const amount = screen.getAllByLabelText(/amount \(\$\)/i)[0]
    if (!amount) throw new Error('amount field missing')
    await userEvent.clear(amount)
    await userEvent.type(amount, '150')
    expect(screen.getByText(/editing payments by hand/i)).toBeTruthy()

    await next()
    expect(screen.getByText(/add up to \$150\.00 but should total \$200\.00/i)).toBeTruthy()
    expect(screen.getByText('Step 3 of 4')).toBeTruthy()
  })

  it('goes back without losing what was typed', async () => {
    renderForm()
    await enterAmounts('120', '0')
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect((screen.getByLabelText(/^amount$/i) as HTMLInputElement).value).toBe('120')
  })

  it('pre-fills a change from existing terms', async () => {
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
        perspective="lender"
        submitLabel="Send"
        messageLabel="Message"
        onSubmit={vi.fn()}
      />,
    )
    expect(screen.getByRole('heading', { name: 'How much will they owe you?' })).toBeTruthy()
    expect((screen.getByLabelText(/^amount$/i) as HTMLInputElement).value).toBe('200')
    await next()
    expect((screen.getByLabelText(/one-off charge/i) as HTMLInputElement).value).toBe('20')
    await next()
    await next()
    expect(screen.getByDisplayValue('Tell me early')).toBeTruthy()
  })

  it('shows server errors from the submit handler', async () => {
    renderForm(vi.fn().mockRejectedValue(new Error('The terms changed while you were looking.')))
    await enterAmounts('50', '0')
    await next()
    await userEvent.click(screen.getByRole('button', { name: /send request/i }))
    expect(await screen.findByText(/terms changed while you were looking/i)).toBeTruthy()
  })

  it('skips the charge for borrowers and uses the lender’s rate', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined)
    render(
      <TermsForm
        submitLabel="Send"
        fixedCharge={(principal) => toCents(Math.round(principal * 0.1))}
        onSubmit={onSubmit}
      />,
    )
    expect(screen.getByText('Step 1 of 3')).toBeTruthy()
    await userEvent.type(screen.getByLabelText(/^amount$/i), '300')
    await next()
    expect(screen.getByRole('heading', { name: 'How will it be paid back?' })).toBeTruthy()
    expect(screen.getByText('$330.00 in total.')).toBeTruthy()
    await next()
    expect(screen.getByText(/only they can change it/i)).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ principalCents: 30000, chargeCents: 3000 }))
  })

  it('has no accessibility problems on any step', async () => {
    renderForm()
    await userEvent.type(screen.getByLabelText(/^amount$/i), '100')
    for (let step = 0; step < 4; step++) {
      await expectNoAxeViolations(document.body)
      if (step < 3) await next()
    }
  })
})
