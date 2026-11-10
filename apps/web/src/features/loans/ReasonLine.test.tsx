// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { expectNoAxeViolations } from '../../test/axe'
import { ReasonLine } from './ReasonLine'

const setLoanReason = vi.hoisted(() => vi.fn(() => Promise.resolve()))
vi.mock('../../data/loans', () => ({ setLoanReason }))
afterEach(cleanup)

describe('ReasonLine', () => {
  it('shows the reason, and lets you change it', async () => {
    const onSaved = vi.fn()
    render(<ReasonLine loanId="l1" reason="Car repairs" onSaved={onSaved} />)
    expect(screen.getByText(/for car repairs/i)).toBeTruthy()
    await expectNoAxeViolations(document.body)

    await userEvent.click(screen.getByRole('button', { name: /change what it’s for/i }))
    const field = screen.getByLabelText('What it’s for')
    await userEvent.clear(field)
    await userEvent.type(field, 'Car repairs and WOF')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(setLoanReason).toHaveBeenCalledWith('l1', 'Car repairs and WOF')
    expect(onSaved).toHaveBeenCalled()
  })

  it('offers to add one when there is none', async () => {
    render(<ReasonLine loanId="l1" reason={null} onSaved={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: 'Add what it’s for' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByText('Say what it’s for.')).toBeTruthy()
  })
})
