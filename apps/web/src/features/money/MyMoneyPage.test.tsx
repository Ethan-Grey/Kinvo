// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { addDays, todayInNZ } from '../../domain/dates'
import type { MyMoney } from '../../data/myMoney'
import { expectNoAxeViolations } from '../../test/axe'
import { MyMoneyPage } from './MyMoneyPage'

const today = todayInNZ()
const money = vi.hoisted(() => ({ current: null as unknown }))
const api = vi.hoisted(() => ({
  savePay: vi.fn(() => Promise.resolve()),
  setMyBalance: vi.fn(() => Promise.resolve()),
  savePersonalBill: vi.fn(() => Promise.resolve()),
  stopPersonalBill: vi.fn(() => Promise.resolve()),
}))
vi.mock('../../data/myMoney', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../data/myMoney')>()),
  ...api,
  getMyMoney: () => Promise.resolve(money.current),
}))
vi.mock('../auth/useAuth', () => ({ useAuth: () => ({ session: { user: { id: 'me' } } }) }))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const page = () =>
  render(
    <MemoryRouter>
      <MyMoneyPage />
    </MemoryRouter>,
  )

describe('MyMoneyPage', () => {
  it('asks for pay first', async () => {
    money.current = {
      pay: null,
      balance: null,
      bills: [],
      topups: [],
      loanPayments: [],
      householdShares: [],
    } satisfies MyMoney
    const { container } = page()
    await screen.findByRole('heading', { name: 'When do you get paid?' })
    await expectNoAxeViolations(container)
    await userEvent.type(screen.getByLabelText('Take-home pay each time ($)'), '1200')
    await userEvent.click(screen.getByRole('button', { name: 'Save pay' }))
    await waitFor(() => expect(api.savePay).toHaveBeenCalledWith(120000, 'fortnightly', addDays(today, 7)))
  })

  it('shows what’s safe to spend after everything due before pay day', async () => {
    money.current = {
      pay: { amountCents: 120000, frequency: 'fortnightly', nextPayOn: addDays(today, 5) },
      balance: { cents: 50000, on: today },
      bills: [
        {
          id: 'b',
          name: 'Phone',
          category: 'phone',
          amountType: 'fixed',
          amountCents: 4500 as never,
          frequency: 'monthly',
          firstDueOn: addDays(today, 2),
        },
      ],
      topups: [
        {
          householdName: 'Our place',
          amountCents: 35000,
          frequency: 'weekly',
          firstOn: addDays(today, 1),
          nextOn: addDays(today, 1),
        },
      ],
      loanPayments: [{ otherPersonName: 'Hana Grey', dueOn: addDays(today, -2), remainingCents: 5000, loanId: 'l' }],
      householdShares: [],
    } satisfies MyMoney
    const { container } = page()
    expect(await screen.findByText('$55.00')).toBeTruthy()
    expect(screen.getAllByText('Phone')).toHaveLength(2) // coming out, and my bills
    expect(screen.getByText('Top-up: Our place')).toBeTruthy()
    expect(screen.getByText('Pay back Hana Grey')).toBeTruthy()
    expect(screen.getByText(/Overdue since/)).toBeTruthy()
    await expectNoAxeViolations(container)
  })
})
