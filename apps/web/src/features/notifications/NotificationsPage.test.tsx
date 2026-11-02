// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppNotification } from '../../data/notifications'
import { NotificationBell } from './NotificationBell'
import { NotificationsPage } from './NotificationsPage'
import { UnreadCountProvider } from './UnreadCountProvider'
import { expectNoAxeViolations } from '../../test/axe'

const api = vi.hoisted(() => ({
  listNotifications: vi.fn(),
  countUnread: vi.fn(),
  markRead: vi.fn(),
}))
vi.mock('../../data/notifications', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../data/notifications')>()),
  listNotifications: api.listNotifications,
  countUnread: api.countUnread,
  markRead: api.markRead,
}))

const unread: AppNotification = {
  id: 'n1',
  kind: 'payment_claimed',
  title: 'Bob says they paid you $50.00',
  body: 'Check your account, then confirm it in Kinvo.',
  linkPath: '/loans/abc',
  createdAt: new Date().toISOString(),
  readAt: null,
}

function renderWithBell() {
  return render(
    <MemoryRouter initialEntries={['/notifications']}>
      <UnreadCountProvider>
        <NotificationBell />
        <NotificationsPage />
      </UnreadCountProvider>
    </MemoryRouter>,
  )
}

describe('notifications', () => {
  beforeEach(() => {
    api.markRead.mockResolvedValue(undefined)
  })
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('lists notifications linking to their loan, then marks them read', async () => {
    api.listNotifications.mockResolvedValue([unread])
    api.countUnread.mockResolvedValueOnce(1).mockResolvedValue(0)
    renderWithBell()

    const link = await screen.findByRole('link', { name: /Bob says they paid you \$50\.00/ })
    expect(link.getAttribute('href')).toBe('/loans/abc')
    expect(screen.getByText('just now')).toBeTruthy()

    await waitFor(() => expect(api.markRead).toHaveBeenCalledWith())
    await waitFor(() => expect(screen.getByRole('link', { name: 'Notifications' })).toBeTruthy())
  })

  it('shows the unread count on the bell', async () => {
    api.listNotifications.mockReturnValue(new Promise(() => {}))
    api.countUnread.mockResolvedValue(3)
    renderWithBell()
    expect(await screen.findByRole('link', { name: 'Notifications, 3 unread' })).toBeTruthy()
  })

  it('explains what will appear when there is nothing yet', async () => {
    api.listNotifications.mockResolvedValue([])
    api.countUnread.mockResolvedValue(0)
    renderWithBell()
    expect(await screen.findByText(/Nothing yet/)).toBeTruthy()
    expect(api.markRead).not.toHaveBeenCalled()
  })

  it('has no accessibility problems', async () => {
    api.listNotifications.mockResolvedValue([unread])
    api.countUnread.mockResolvedValue(1)
    const { container } = renderWithBell()
    await screen.findByRole('link', { name: /Bob says they paid you/ })
    await expectNoAxeViolations(container)
  })
})
