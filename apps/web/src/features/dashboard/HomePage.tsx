import { Link, useLocation } from 'react-router'
import { formatDate } from '../../domain/dates'
import { formatCents } from '../../domain/money'
import { getDashboardSummary, listUpcomingInstalments, type DashboardSummary, type UpcomingInstalment } from '../../data/dashboard'
import { getMyProfile, listPeople } from '../../data/people'
import { useAsync } from '../../shared/useAsync'
import { Badge, Card, Notice, Spinner, Stat } from '../../shared/ui'
import { useAuth } from '../auth/useAuth'

/**
 * Home tab: what needs doing, then money lent and borrowed (DB-01, DB-02).
 * Sections appear only for the roles the user actually has.
 */
export function HomePage() {
  const { session } = useAuth()
  const userId = session?.user.id ?? ''
  const location = useLocation()
  const justJoined = (location.state as { joined?: boolean } | null)?.joined === true

  const [data] = useAsync(async () => {
    const [profile, people, summary, upcoming] = await Promise.all([
      getMyProfile(userId),
      listPeople(userId),
      getDashboardSummary(),
      listUpcomingInstalments(6),
    ])
    return { profile, people, summary, upcoming }
  }, userId)

  if (data.status === 'loading') return <Spinner label="Loading…" />
  if (data.status === 'error') return <Notice tone="error">{data.error.message}</Notice>

  const { profile, people, summary, upcoming } = data.data
  const isLender = profile.can_lend
  const isBorrower = people.lenders.length > 0 || summary.borrowing.activeCount > 0
  const hasNoOne = people.lenders.length === 0 && people.borrowers.length === 0

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold tracking-tight">Kia ora, {profile.display_name.split(' ')[0]}</h1>

      {justJoined && <Notice tone="success">You’re connected. You can now request a loan from the Loans tab.</Notice>}

      <NeedsYou summary={summary} />

      {isLender && <LendingCard summary={summary} />}
      {isBorrower && <BorrowingCard summary={summary} />}

      {upcoming.length > 0 && <UpcomingCard upcoming={upcoming} />}

      {hasNoOne && (
        <Card className="space-y-2">
          <h2 className="font-semibold">Get started</h2>
          <p className="text-sm text-ink-muted">
            {isLender
              ? 'Invite someone from the People tab to start lending.'
              : 'Ask the person lending to you for an invite link.'}
          </p>
          {isLender && (
            <Link to="/people" className="text-sm font-medium text-brand-ink underline">
              Go to People
            </Link>
          )}
        </Card>
      )}
    </div>
  )
}

function NeedsYou({ summary }: { summary: DashboardSummary }) {
  const { repliesNeeded, fundsToSend, claimsToConfirm, claimsDisputed } = summary.actions
  const items = [
    repliesNeeded > 0 && `${repliesNeeded} loan proposal${repliesNeeded === 1 ? '' : 's'} to answer`,
    fundsToSend > 0 && `${fundsToSend} agreed loan${fundsToSend === 1 ? '' : 's'} to send money for`,
    claimsToConfirm > 0 && `${claimsToConfirm} payment${claimsToConfirm === 1 ? '' : 's'} to confirm`,
    claimsDisputed > 0 && `${claimsDisputed} payment${claimsDisputed === 1 ? '' : 's'} disputed by your lender`,
  ].filter((item): item is string => typeof item === 'string')

  if (items.length === 0) return null

  return (
    <Link to="/loans" className="block rounded-2xl bg-attention p-4 text-on-attention hover:opacity-90">
      <p className="text-sm font-semibold">Needs you</p>
      <ul className="mt-1 space-y-0.5 text-sm">
        {items.map((item) => (
          <li key={item}>• {item}</li>
        ))}
      </ul>
    </Link>
  )
}

function LendingCard({ summary }: { summary: DashboardSummary }) {
  const l = summary.lending
  return (
    <Card className="space-y-4">
      <h2 className="font-semibold">Lending</h2>
      <div className="grid grid-cols-2 gap-4">
        <Stat label="Owed to you" value={formatCents(l.owedCents)} tone="brand" hint={`${l.activeCount} active loan${l.activeCount === 1 ? '' : 's'}`} />
        <Stat
          label="Overdue"
          value={formatCents(l.overdueCents)}
          tone={l.overdueCount > 0 ? 'danger' : 'default'}
          hint={l.overdueCount > 0 ? `${l.overdueCount} payment${l.overdueCount === 1 ? '' : 's'}` : 'Nothing overdue'}
        />
        <Stat label="Total lent" value={formatCents(l.totalLentCents)} hint="All time" />
        <Stat
          label="Charges received"
          value={formatCents(l.chargesReceivedCents)}
          hint={`Since ${formatDate(l.taxYearStart)} (tax year)`}
        />
      </div>
    </Card>
  )
}

function BorrowingCard({ summary }: { summary: DashboardSummary }) {
  const b = summary.borrowing
  return (
    <Card className="space-y-4">
      <h2 className="font-semibold">Borrowing</h2>
      <div className="grid grid-cols-2 gap-4">
        <Stat label="You owe" value={formatCents(b.owedCents)} tone="brand" hint={`${b.activeCount} active loan${b.activeCount === 1 ? '' : 's'}`} />
        {b.nextDueOn && b.nextDueCents !== null ? (
          <Stat label="Next payment" value={formatCents(b.nextDueCents)} hint={`Due ${formatDate(b.nextDueOn)}`} />
        ) : (
          <Stat label="Next payment" value="—" hint="Nothing due" />
        )}
      </div>
      {b.overdueCount > 0 && (
        <Notice tone="error">
          {formatCents(b.overdueCents)} is overdue. Pay what you can and tap “I’ve paid” on the loan.
        </Notice>
      )}
    </Card>
  )
}

function UpcomingCard({ upcoming }: { upcoming: UpcomingInstalment[] }) {
  return (
    <Card>
      <h2 className="font-semibold">Coming up</h2>
      <ul className="mt-2 divide-y divide-line">
        {upcoming.map((item) => (
          <li key={`${item.loanId}-${item.sequence}`}>
            <Link to={`/loans/${item.loanId}`} className="flex items-center justify-between gap-3 py-2.5 hover:opacity-80">
              <div>
                <p className="text-sm font-medium">
                  {item.role === 'lender' ? `${item.otherPersonName} pays you` : `You pay ${item.otherPersonName}`}
                </p>
                <p className="text-xs text-ink-muted">{formatDate(item.dueOn)}</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold tabular-nums">{formatCents(item.remainingCents)}</span>
                {item.status === 'overdue' && <Badge tone="danger">Overdue</Badge>}
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  )
}
