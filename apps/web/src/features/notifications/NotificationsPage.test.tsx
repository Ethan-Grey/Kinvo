// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppNotification } from '../../data/notifications'
import { NotificationsPage } from './NotificationsPage'
import { UnreadCountProvider } from './UnreadCountProvider'
import { useUnreadCount } from './useUnreadCount'

/** Stands in for the tab bar badge, which reads the same count. */
function CountProbe() {
  const { count } = useUnreadCount()
  return <p>Unread: {count ?? '…'}</p>
}
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
        <CountProbe />
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
    await waitFor(() => expect(screen.getByText('Unread: 0')).toBeTruthy())
  })

  it('keeps the unread count for the tab bar', async () => {
    api.listNotifications.mockReturnValue(new Promise(() => {}))
    api.countUnread.mockResolvedValue(3)
    renderWithBell()
    expect(await screen.findByText('Unread: 3')).toBeTruthy()
  })

  it('explains what will appear when there is nothing yet', async () => {
    api.listNotifications.mockResolvedValue([])
    api.countUnread.mockResolvedValue(0)
    renderWithBell()
    expect(await screen.findByText(/all caught up/)).toBeTruthy()
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
