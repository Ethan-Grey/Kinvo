// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { expectNoAxeViolations } from '../../test/axe'
import { RemindersPage } from './RemindersPage'

const reminders = vi.hoisted(() => ({
  getReminderSettings: vi.fn(() =>
    Promise.resolve({ sendHour: 9, dayBefore: true, onTheDay: true, whenOverdue: true, overdueEveryDays: 7 }),
  ),
  saveReminderSettings: vi.fn(() => Promise.resolve()),
  listCustomReminders: vi.fn(() =>
    Promise.resolve([
      {
        id: 'r1',
        loanId: null,
        message: 'Pay day tomorrow',
        firstOn: '2026-11-10',
        sendHour: 18,
        repeat: 'weekly',
        sentCount: 0,
        nextAt: '2026-11-10T05:00:00Z',
        cancelledAt: null,
      },
    ]),
  ),
  createCustomReminder: vi.fn(() => Promise.resolve()),
  cancelCustomReminder: vi.fn(() => Promise.resolve()),
}))
vi.mock('../../data/reminders', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../data/reminders')>()),
  ...reminders,
}))
vi.mock('../../data/people', () => ({
  listPeople: () =>
    Promise.resolve({ lenders: [], borrowers: [{ relationshipId: 'rel-1', personName: 'Bob Borrower' }] }),
}))
vi.mock('../../data/loans', () => ({ listLoans: () => Promise.resolve([]) }))
vi.mock('../auth/useAuth', () => ({ useAuth: () => ({ session: { user: { id: 'lena' } } }) }))

afterEach(cleanup)

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/people/rel-1/reminders']}>
      <Routes>
        <Route path="/people/:relationshipId/reminders" element={<RemindersPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('RemindersPage', () => {
  it('saves the reminder time and which reminders go out', async () => {
    const { container } = renderPage()
    await screen.findByRole('heading', { name: 'Reminders for Bob' })
    await expectNoAxeViolations(container)

    await userEvent.selectOptions(screen.getByLabelText('Send them at'), '18')
    await userEvent.click(screen.getByRole('switch', { name: 'The day before' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(reminders.saveReminderSettings).toHaveBeenCalledWith('rel-1', {
      sendHour: 18,
      dayBefore: false,
      onTheDay: true,
      whenOverdue: true,
      overdueEveryDays: 7,
    })
    expect(await screen.findByText('Saved.')).toBeTruthy()
  })

  it('lists, adds and cancels custom reminders', async () => {
    renderPage()
    expect(await screen.findByText('“Pay day tomorrow”')).toBeTruthy()
    expect(screen.getByText(/Next Tue 10 Nov, 6pm, every week/)).toBeTruthy()

    await userEvent.type(screen.getByLabelText('Message'), 'Rent week')
    await userEvent.selectOptions(screen.getByLabelText('Repeat'), 'monthly')
    await userEvent.click(screen.getByRole('button', { name: 'Set reminder' }))
    expect(reminders.createCustomReminder).toHaveBeenCalledWith(
      'rel-1',
      expect.objectContaining({ message: 'Rent week', repeat: 'monthly', sendHour: 9, loanId: null }),
    )

    await userEvent.click(screen.getByRole('button', { name: /cancel.*pay day tomorrow/i }))
    await waitFor(() => expect(reminders.cancelCustomReminder).toHaveBeenCalledWith('r1'))
  })
})
