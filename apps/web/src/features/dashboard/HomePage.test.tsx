// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toCents } from '../../domain/money'
import type { DashboardSummary } from '../../data/dashboard'
import { HomePage } from './HomePage'
import { expectNoAxeViolations } from '../../test/axe'

const api = vi.hoisted(() => ({
  getDashboardSummary: vi.fn(),
  listUpcomingInstalments: vi.fn(),
  getMyProfile: vi.fn(),
  listPeople: vi.fn(),
  listLoans: vi.fn(),
}))
vi.mock('../../data/loans', () => ({ listLoans: api.listLoans }))
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
  borrowing: {
    owedCents: toCents(0),
    overdueCents: toCents(0),
    overdueCount: 0,
    nextDueOn: null,
    nextDueCents: null,
    activeCount: 0,
  },
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
    api.listLoans.mockResolvedValue([])
    api.getMyProfile.mockResolvedValue({ display_name: 'Ethan Grey', email: 'e@example.test', can_lend: true })
    api.listPeople.mockResolvedValue({
      lenders: [],
      borrowers: [{ relationshipId: 'r1', personId: 'b', personName: 'Bob', since: '' }],
    })
  })
  afterEach(cleanup)

  it('shows lending figures and what needs doing', async () => {
    api.getDashboardSummary.mockResolvedValue({
      ...empty,
      lending: {
        ...empty.lending,
        owedCents: toCents(15000),
        overdueCents: toCents(5000),
        overdueCount: 1,
        activeCount: 1,
      },
      actions: { ...empty.actions, claimsToConfirm: 2, repliesNeeded: 1 },
    })
    renderHome()

    expect(await screen.findByText('Kia ora, Ethan')).toBeTruthy()
    expect(screen.getByText('Needs you')).toBeTruthy()
    expect(screen.getByRole('link', { name: /2 payments to confirm/ }).getAttribute('href')).toBe('/loans?show=lending')
    expect(screen.getByRole('link', { name: /1 proposal to answer/ }).getAttribute('href')).toBe('/loans?show=waiting')
    expect(screen.getByText('Owed to you')).toBeTruthy()
    expect(screen.getByText('$150.00')).toBeTruthy()
    expect(screen.getByText('$50.00')).toBeTruthy()
    expect(screen.queryByText('You owe')).toBeNull()
  })

  it('hides "Needs you" when nothing is waiting', async () => {
    api.getDashboardSummary.mockResolvedValue(empty)
    renderHome()
    expect(await screen.findByText('Owed to you')).toBeTruthy()
    expect(screen.queryByText('Needs you')).toBeNull()
  })

  it('shows what you owe to someone with a lender', async () => {
    api.getMyProfile.mockResolvedValue({ display_name: 'Bob', email: 'b@example.test', can_lend: false })
    api.listPeople.mockResolvedValue({
      lenders: [{ relationshipId: 'r1', personId: 'l', personName: 'Lena', since: '' }],
      borrowers: [],
    })
    api.getDashboardSummary.mockResolvedValue({
      ...empty,
      borrowing: {
        ...empty.borrowing,
        owedCents: toCents(15000),
        nextDueOn: '2026-11-09',
        nextDueCents: toCents(15000),
        activeCount: 1,
      },
    })
    renderHome()

    expect(await screen.findByText('You owe')).toBeTruthy()
    expect(screen.getByText('Next payment')).toBeTruthy()
    expect(screen.getByText('Mon, 9 Nov')).toBeTruthy()
    expect(screen.queryByText('Owed to you')).toBeNull()
  })

  it('gives borrowers a clear Pay back, and a bar for each person they owe', async () => {
    api.getMyProfile.mockResolvedValue({ display_name: 'Bob', email: 'b@example.test', can_lend: false })
    api.listPeople.mockResolvedValue({
      lenders: [{ relationshipId: 'r1', personId: 'l', personName: 'Lena Grey', since: '' }],
      borrowers: [],
    })
    api.getDashboardSummary.mockResolvedValue({
      ...empty,
      borrowing: {
        ...empty.borrowing,
        owedCents: toCents(15000),
        nextDueOn: '2026-11-09',
        nextDueCents: toCents(5000),
        activeCount: 1,
      },
    })
    api.listLoans.mockResolvedValue([
      {
        id: 'L1',
        relationshipId: 'r1',
        status: 'active',
        kind: 'new',
        role: 'borrower',
        otherPersonName: 'Lena Grey',
        principalCents: toCents(20000),
        totalCents: toCents(20000),
        firstDueOn: '2026-11-09',
        awaitingMe: false,
        createdAt: '',
        balance: {
          totalCents: toCents(20000),
          paidCents: toCents(5000),
          writtenOffCents: toCents(0),
          outstandingCents: toCents(15000),
          nextDueOn: '2026-11-09',
          nextDueCents: toCents(5000),
          overdueCents: toCents(0),
          overdueCount: 0,
        },
      },
    ])
    renderHome()

    expect((await screen.findByRole('link', { name: 'Pay back' })).getAttribute('href')).toBe('/loans/L1/pay')
    expect(screen.getByRole('heading', { name: 'Who you owe' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Pay Lena' }).getAttribute('href')).toBe('/loans/L1/pay')
  })

  it('has no accessibility problems', async () => {
    api.getDashboardSummary.mockResolvedValue({ ...empty, actions: { ...empty.actions, claimsToConfirm: 1 } })
    const { container } = renderHome()
    await screen.findByText('Kia ora, Ethan')
    await expectNoAxeViolations(container)
  })
})
