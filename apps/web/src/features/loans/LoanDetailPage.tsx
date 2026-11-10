import { Link, useLocation, useParams } from 'react-router'
import { formatDate } from '../../domain/dates'
import { formatCents } from '../../domain/money'
import { getLoan, isAwaitingUser, type LoanDetail } from '../../data/loans'
import { useAsync } from '../../shared/useAsync'
import { Badge, Notice, PageHeader, PageSkeleton } from '../../shared/ui'
import { RepaymentsPanel } from '../repayments/RepaymentsPanel'
import { useAuth } from '../auth/useAuth'
import { statusBadge } from './labels'
import { LoanActions } from './LoanActions'
import { ReasonLine } from './ReasonLine'

/** /loans/:id — what it's for, where it stands, and what to do next. */
export function LoanDetailPage() {
  const { id = '' } = useParams()
  const { session } = useAuth()
  const userId = session?.user.id ?? ''
  const [loan, reload] = useAsync(() => getLoan(id, userId), `${id}:${userId}`)
  const location = useLocation()
  const flash = (location.state as { flash?: string } | null)?.flash

  if (loan.status === 'loading') return <PageSkeleton label="Loading" />
  if (loan.status === 'error') return <Notice tone="error">{loan.error.message}</Notice>

  const data = loan.data
  const badge = statusBadge(
    data.status,
    data.role,
    isAwaitingUser(data.status, data.role, data.currentTerms.proposedBy, userId),
  )
  const otherName = data.role === 'lender' ? data.borrowerName : data.lenderName
  const funded = data.status === 'active' || data.status === 'completed' || data.status === 'written_off'

  return (
    <div className="space-y-5">
      <PageHeader
        back={{ to: '/loans', label: 'Owed' }}
        title={
          data.kind === 'existing_debt'
            ? data.role === 'lender'
              ? `${otherName}’s existing debt`
              : `Existing debt to ${otherName}`
            : data.role === 'lender'
              ? `${otherName} owes you`
              : `You owe ${otherName}`
        }
        subtitle={
          <>
            <ReasonLine loanId={data.id} reason={data.reason} onSaved={reload} />
            {data.originallyLentOn &&
              (data.kind === 'bill' ? (
                <p>Bill paid {formatDate(data.originallyLentOn)}</p>
              ) : data.kind === 'repeating' ? (
                <p>
                  Due {formatDate(data.originallyLentOn)}.{' '}
                  {data.repeatingDebtId && (
                    <Link to={`/repeating/${data.repeatingDebtId}`} className="font-medium text-brand-ink underline">
                      See the repeating debt
                    </Link>
                  )}
                </p>
              ) : (
                <p>Originally lent {formatDate(data.originallyLentOn)}, before Kinvo</p>
              ))}
          </>
        }
        action={<Badge tone={badge.tone}>{badge.label}</Badge>}
      />

      {flash && <Notice tone="success">{flash}</Notice>}

      {funded ? (
        <RepaymentsPanel loan={data} onLoanChanged={reload} />
      ) : (
        <>
          <ProposalCard loan={data} userId={userId} />
          {(data.status === 'negotiating' || data.status === 'agreed') && (
            <LoanActions loan={data} userId={userId} onChanged={reload} />
          )}
        </>
      )}
    </div>
  )
}

/** The proposal in one sentence and one number, so it's clear at a glance. */
function ProposalCard({ loan, userId }: { loan: LoanDetail; userId: string }) {
  const terms = loan.currentTerms
  const proposer = nameOf(loan, userId, terms.proposedBy)
  const byMe = terms.proposedBy === userId
  const isDebt = loan.kind === 'existing_debt'
  const first = loan.borrowerName.split(' ')[0]
  const headline =
    loan.kind === 'bill'
      ? loan.role === 'lender'
        ? `${first}’s share`
        : 'Your share'
      : isDebt
        ? loan.role === 'lender'
          ? `${first} owes you`
          : `You owe ${loan.lenderName.split(' ')[0]}`
        : loan.role === 'lender'
          ? byMe
            ? `You offered ${first}`
            : `${first} asks you for`
          : byMe
            ? 'You asked for'
            : `${loan.lenderName.split(' ')[0]} offers you`
  const last = terms.instalments.at(-1)
  const count = terms.instalments.length

  return (
    <section className="space-y-4 rounded-3xl border border-line p-5">
      <div>
        <p className="text-sm text-ink-muted">{headline}</p>
        <p className="font-display text-[2.75rem] leading-none font-semibold tabular-nums">
          {formatCents(terms.principalCents)}
        </p>
        <p className="mt-2">
          {isDebt ? 'Paid back' : 'Pay back'}{' '}
          <span className="font-semibold tabular-nums">{formatCents(terms.totalCents)}</span>
          {terms.chargeCents > 0 && (
            <span className="text-ink-muted"> (includes {formatCents(terms.chargeCents)} charge)</span>
          )}
          {' in '}
          {count === 1 ? 'one payment' : `${count} payments`}
          {last && (
            <>
              {count === 1 ? ' on ' : ', the last on '}
              <span className="font-semibold">{formatDate(last.dueOn)}</span>
            </>
          )}
          .
        </p>
      </div>
      {terms.message && (
        <blockquote className="rounded-2xl rounded-tl-sm bg-brand-soft px-4 py-3 text-sm text-on-brand-soft">
          <span className="font-semibold">{proposer}:</span> {terms.message}
        </blockquote>
      )}
    </section>
  )
}

function nameOf(loan: LoanDetail, userId: string, personId: string): string {
  if (personId === userId) return 'You'
  return personId === loan.lenderId ? loan.lenderName : loan.borrowerName
}
