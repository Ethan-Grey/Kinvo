// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toCents } from '../../domain/money'
import type { DashboardSummary } from '../../data/dashboard'
import { HomePage } from './HomePage'

const api = vi.hoisted(() => ({
  getDashboardSummary: vi.fn(),
  listUpcomingInstalments: vi.fn(),
  getMyProfile: vi.fn(),
  listPeople: vi.fn(),
}))
vi.mock('../../data/dashboard', () => ({
  getDashboardSummary: api.getDashboardSummary,
  listUpcomingInstalments: api.listUpcomingInstalments,
}))
vi.mock('../../data/people', () => ({ getMyProfile: api.getMyProfile, listPeople: api.listPeople }))
vi.mock('../auth/useAuth', () => ({ useAuth: () => ({ session: { user: { id: 'me' } }, loading: false }) }))

const empty: DashboardSummary = {
  lending: {
    owedCents: toCents(0),
    overdueCents: toCents(0),
    overdueCount: 0,
    totalLentCents: toCents(0),
    activeCount: 0,
    chargesReceivedCents: toCents(0),
    taxYearStart: '2026-04-01',
  },
  borrowing: { owedCents: toCents(0), overdueCents: toCents(0), overdueCount: 0, nextDueOn: null, nextDueCents: null, activeCount: 0 },
  actions: { repliesNeeded: 0, fundsToSend: 0, claimsToConfirm: 0, claimsDisputed: 0 },
}

function renderHome() {
  return render(
    <MemoryRouter>
      <HomePage />
    </MemoryRouter>,
  )
}

describe('HomePage', () => {
  beforeEach(() => {
    api.listUpcomingInstalments.mockResolvedValue([])
    api.getMyProfile.mockResolvedValue({ display_name: 'Ethan Grey', email: 'e@example.test', can_lend: true })
    api.listPeople.mockResolvedValue({ lenders: [], borrowers: [{ relationshipId: 'r1', personId: 'b', personName: 'Bob', since: '' }] })
  })
  afterEach(cleanup)

  it('shows lending figures and what needs doing', async () => {
    api.getDashboardSummary.mockResolvedValue({
      ...empty,
      lending: { ...empty.lending, owedCents: toCents(15000), overdueCents: toCents(5000), overdueCount: 1, activeCount: 1 },
      actions: { ...empty.actions, claimsToConfirm: 2, repliesNeeded: 1 },
    })
    renderHome()

    expect(await screen.findByText('Kia ora, Ethan')).toBeTruthy()
    expect(screen.getByText('Needs you')).toBeTruthy()
    expect(screen.getByText(/2 payments to confirm/)).toBeTruthy()
    expect(screen.getByText(/1 loan proposal to answer/)).toBeTruthy()
    expect(screen.getByText('$150.00')).toBeTruthy()
    expect(screen.getByText('$50.00')).toBeTruthy()
    expect(screen.queryByText('Borrowing')).toBeNull()
  })

  it('hides "Needs you" when nothing is waiting', async () => {
    api.getDashboardSummary.mockResolvedValue(empty)
    renderHome()
    expect(await screen.findByText('Lending')).toBeTruthy()
    expect(screen.queryByText('Needs you')).toBeNull()
  })

  it('shows the borrowing card for someone with a lender', async () => {
    api.getMyProfile.mockResolvedValue({ display_name: 'Bob', email: 'b@example.test', can_lend: false })
    api.listPeople.mockResolvedValue({ lenders: [{ relationshipId: 'r1', personId: 'l', personName: 'Lena', since: '' }], borrowers: [] })
    api.getDashboardSummary.mockResolvedValue({
      ...empty,
      borrowing: { ...empty.borrowing, owedCents: toCents(15000), nextDueOn: '2026-11-09', nextDueCents: toCents(15000), activeCount: 1 },
    })
    renderHome()

    expect(await screen.findByText('Borrowing')).toBeTruthy()
    expect(screen.getByText('You owe')).toBeTruthy()
    expect(screen.getByText(/Due Mon, 9 Nov 2026/)).toBeTruthy()
    expect(screen.queryByText('Lending')).toBeNull()
  })
})
