// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { expectNoAxeViolations } from '../../test/axe'
import { PhoneNotificationsCard } from './PhoneNotifications'

const push = vi.hoisted(() => ({ pushState: vi.fn(), turnOnPush: vi.fn(), turnOffPush: vi.fn() }))
vi.mock('../../data/push', () => push)

describe('PhoneNotificationsCard', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('turns notifications on from a tap', async () => {
    push.pushState.mockResolvedValue('off')
    push.turnOnPush.mockResolvedValue('on')
    render(<PhoneNotificationsCard />)
    await userEvent.click(await screen.findByRole('button', { name: 'Turn on notifications' }))
    expect(push.turnOnPush).toHaveBeenCalled()
    expect(await screen.findByRole('button', { name: 'Turn off on this phone' })).toBeTruthy()
  })

  it('explains Add to Home Screen on iPhone in Safari', async () => {
    push.pushState.mockResolvedValue('needs-install')
    render(<PhoneNotificationsCard />)
    expect(await screen.findByText(/Add to Home Screen/)).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('points to Settings when notifications are blocked', async () => {
    push.pushState.mockResolvedValue('blocked')
    const { container } = render(<PhoneNotificationsCard />)
    expect(await screen.findByText(/Settings → Notifications → Kinvo/)).toBeTruthy()
    await expectNoAxeViolations(container)
  })
})
