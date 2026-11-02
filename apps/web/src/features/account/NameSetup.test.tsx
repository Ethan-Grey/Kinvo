// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Profile } from '../../data/database.types'
import { expectNoAxeViolations } from '../../test/axe'
import { NameSetup } from './NameSetup'

const setDisplayName = vi.hoisted(() => vi.fn())
vi.mock('../../data/account', () => ({ setDisplayName }))

const profile: Profile = {
  id: 'me',
  display_name: 'bobby99',
  email: 'bobby99@example.test',
  can_lend: false,
  created_at: '',
  email_notifications: true,
  name_confirmed: false,
  avatar_path: null,
}

describe('NameSetup', () => {
  afterEach(cleanup)

  it('doesn’t suggest the email name, and saves the real one', async () => {
    setDisplayName.mockResolvedValue(undefined)
    const onDone = vi.fn()
    render(<NameSetup profile={profile} onDone={onDone} />)

    const field = screen.getByLabelText('Your name') as HTMLInputElement
    expect(field.value).toBe('')
    await userEvent.type(field, 'Bob Borrower')
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))

    expect(setDisplayName).toHaveBeenCalledWith('Bob Borrower')
    expect(onDone).toHaveBeenCalled()
  })

  it('keeps a name that came from Google', () => {
    render(<NameSetup profile={{ ...profile, display_name: 'Bob Borrower' }} onDone={vi.fn()} />)
    expect((screen.getByLabelText('Your name') as HTMLInputElement).value).toBe('Bob Borrower')
  })

  it('has no accessibility problems', async () => {
    const { container } = render(<NameSetup profile={profile} onDone={vi.fn()} />)
    await expectNoAxeViolations(container)
  })
})
