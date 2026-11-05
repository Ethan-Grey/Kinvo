import { Link, useLocation, useParams } from 'react-router'
import { formatDate } from '../../domain/dates'
import { formatCents } from '../../domain/money'
import { getLoan, isAwaitingUser, type LoanDetail, type TermsVersion } from '../../data/loans'
import { BellIcon } from '../../shared/icons'
import { useAsync } from '../../shared/useAsync'
import { Badge, Notice, PageHeader, PageSkeleton } from '../../shared/ui'
import { RepaymentsPanel } from '../repayments/RepaymentsPanel'
import { useAuth } from '../auth/useAuth'
import { methodLabel, statusBadge } from './labels'
import { LoanActions } from './LoanActions'
import { LoanReason } from './LoanStepPages'
import { TermsSummary } from './TermsSummary'

const timestamp = new Intl.DateTimeFormat('en-NZ', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Pacific/Auckland',
})

/** /loans/:id — the agreement, what to do next, and the full proposal history. */
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
          (data.originallyLentOn || (data.reason && (data.kind === 'bill' || data.kind === 'repeating'))) && (
            <>
              {data.reason && (data.kind === 'bill' || data.kind === 'repeating') && <p>For {data.reason}</p>}
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
          )
        }
        action={<Badge tone={badge.tone}>{badge.label}</Badge>}
      />

      {flash && <Notice tone="success">{flash}</Notice>}
      {data.kind === 'new' || data.kind === 'existing_debt' ? <LoanReason loan={data} /> : null}

      {funded ? (
        <>
          <RepaymentsPanel loan={data} userId={userId} onLoanChanged={reload} />

          {data.fundsSentOn && data.fundsMethod && (
            <p className="text-sm text-ink-muted">
              {data.lenderName} paid out {formatCents(data.currentTerms.principalCents)} by{' '}
              {methodLabel(data.fundsMethod).toLowerCase()} on {formatDate(data.fundsSentOn)}
              {data.fundsReference ? ` (ref ${data.fundsReference})` : ''}.
            </p>
          )}

          <FullTerms loan={data} userId={userId} title="Agreement" showMessage />
        </>
      ) : (
        <>
          <ProposalCard loan={data} userId={userId} />
          {(data.status === 'negotiating' || data.status === 'agreed') && (
            <LoanActions loan={data} userId={userId} onChanged={reload} />
          )}
          <FullTerms loan={data} userId={userId} title="Full terms" />
        </>
      )}

      {data.history.length > 1 && <History loan={data} userId={userId} />}

      {data.role === 'lender' && (
        <Link
          to={`/people/${data.relationshipId}/reminders`}
          className="flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-line font-semibold hover:border-brand-ink"
        >
          <BellIcon className="size-5" />
          Reminders for {data.borrowerName.split(' ')[0]}
        </Link>
      )}

      {data.role === 'lender' && (
        <Link
          to={`/loans/${data.id}/remove`}
          className="flex min-h-11 items-center justify-center text-sm font-medium text-ink-muted hover:text-danger"
        >
          Remove this
        </Link>
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

/** Everything else (each payment, conditions, who proposed what), folded away until wanted. */
function FullTerms({
  loan,
  userId,
  title,
  showMessage = false,
}: {
  loan: LoanDetail
  userId: string
  title: string
  showMessage?: boolean
}) {
  return (
    <details className="group rounded-3xl border border-line bg-surface p-5">
      <summary className="cursor-pointer list-none font-display text-lg font-semibold">{title}</summary>
      <div className="mt-4 space-y-5">
        <ProposalHeader terms={loan.currentTerms} loan={loan} userId={userId} showMessage={showMessage} />
        <TermsSummary terms={loan.currentTerms} lenderName={loan.lenderName} borrowerName={loan.borrowerName} />
      </div>
    </details>
  )
}

function nameOf(loan: LoanDetail, userId: string, personId: string): string {
  if (personId === userId) return 'You'
  return personId === loan.lenderId ? loan.lenderName : loan.borrowerName
}

function ProposalHeader({
  terms,
  loan,
  userId,
  showMessage,
}: {
  terms: TermsVersion
  loan: LoanDetail
  userId: string
  showMessage: boolean
}) {
  const proposer = nameOf(loan, userId, terms.proposedBy)
  return (
    <div className="space-y-2">
      <p className="text-sm text-ink-muted">
        Version {terms.version}, proposed by {proposer} on {timestamp.format(new Date(terms.createdAt))}
      </p>
      {showMessage && terms.message && (
        <blockquote className="rounded-2xl rounded-tl-sm bg-brand-soft px-4 py-3 text-sm text-on-brand-soft">
          <span className="font-medium">{proposer}:</span> {terms.message}
        </blockquote>
      )}
      {loan.status !== 'negotiating' && terms.acceptances.length > 0 && (
        <ul className="text-xs text-ink-muted">
          {terms.acceptances.map((a) => (
            <li key={a.userId}>
              Accepted by {nameOf(loan, userId, a.userId)} · {timestamp.format(new Date(a.acceptedAt))}
            </li>
          ))}
          <li className="font-mono">Fingerprint {terms.termsHash.slice(0, 16)}…</li>
        </ul>
      )}
    </div>
  )
}

function History({ loan, userId }: { loan: LoanDetail; userId: string }) {
  return (
    <details className="rounded-3xl border border-line bg-surface p-5">
      <summary className="cursor-pointer font-display text-lg font-semibold">
        Earlier proposals ({loan.history.length - 1})
      </summary>
      <ol className="mt-4 space-y-4">
        {loan.history
          .filter((t) => t.id !== loan.currentTerms.id)
          .map((terms) => (
            <li key={terms.id} className="space-y-1 border-t border-line pt-3 text-sm">
              <p className="text-sm text-ink-muted">
                Version {terms.version} from {nameOf(loan, userId, terms.proposedBy)},{' '}
                {timestamp.format(new Date(terms.createdAt))}
              </p>
              <p>
                {formatCents(terms.principalCents)} + {formatCents(terms.chargeCents)} charge, repaid in{' '}
                {terms.instalments.length} payment{terms.instalments.length === 1 ? '' : 's'} from{' '}
                {terms.instalments[0] ? formatDate(terms.instalments[0].dueOn) : '—'}
              </p>
              {terms.message && <p className="text-ink-muted">“{terms.message}”</p>}
            </li>
          ))}
      </ol>
    </details>
  )
}
