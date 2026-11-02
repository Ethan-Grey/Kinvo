import { useState } from 'react'
import { useParams } from 'react-router'
import { formatDate } from '../../domain/dates'
import { formatCents } from '../../domain/money'
import { counterOffer, getLoan, isAwaitingUser, type LoanDetail, type TermsVersion } from '../../data/loans'
import { useAsync } from '../../shared/useAsync'
import { Badge, Card, Notice, PageHeader, PageSkeleton } from '../../shared/ui'
import { RepaymentsPanel } from '../repayments/RepaymentsPanel'
import { useAuth } from '../auth/useAuth'
import { methodLabel, statusBadge } from './labels'
import { LoanActions } from './LoanActions'
import { TermsForm } from './TermsForm'
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
  const [countering, setCountering] = useState(false)

  if (loan.status === 'loading') return <PageSkeleton label="Loading loan" />
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
        back={{ to: '/loans', label: 'Loans' }}
        title={
          data.kind === 'existing_debt'
            ? data.role === 'lender'
              ? `${otherName}’s existing debt`
              : `Existing debt to ${otherName}`
            : data.role === 'lender'
              ? `Loan to ${otherName}`
              : `Loan from ${otherName}`
        }
        subtitle={
          (data.reason || data.originallyLentOn) && (
            <>
              {data.reason && <p>For {data.reason}</p>}
              {data.originallyLentOn && <p>Originally lent {formatDate(data.originallyLentOn)}, before Kinvo</p>}
            </>
          )
        }
        action={<Badge tone={badge.tone}>{badge.label}</Badge>}
      />

      {countering ? (
        <Card>
          <h2 className="mb-4 text-lg font-semibold">Suggest different terms</h2>
          <TermsForm
            initial={{ ...data.currentTerms, message: '' }}
            variant={data.kind}
            submitLabel={`Send to ${otherName}`}
            messageLabel={`Message to ${otherName} (optional)`}
            onCancel={() => setCountering(false)}
            onSubmit={async (input) => {
              await counterOffer(data.id, data.currentTerms.id, input)
              setCountering(false)
              reload()
            }}
          />
        </Card>
      ) : funded ? (
        <>
          <RepaymentsPanel loan={data} userId={userId} onLoanChanged={reload} />

          {data.fundsSentOn && data.fundsMethod && (
            <p className="text-sm text-ink-muted">
              {data.lenderName} sent {formatCents(data.currentTerms.principalCents)} by{' '}
              {methodLabel(data.fundsMethod).toLowerCase()} on {formatDate(data.fundsSentOn)}
              {data.fundsReference ? ` (ref ${data.fundsReference})` : ''}.
            </p>
          )}

          <details className="rounded-3xl border border-line bg-surface p-5">
            <summary className="cursor-pointer font-display text-lg font-semibold">Loan agreement</summary>
            <div className="mt-4 space-y-5">
              <ProposalHeader terms={data.currentTerms} loan={data} userId={userId} />
              <TermsSummary terms={data.currentTerms} lenderName={data.lenderName} borrowerName={data.borrowerName} />
            </div>
          </details>
        </>
      ) : (
        <>
          <Card className="space-y-5">
            <ProposalHeader terms={data.currentTerms} loan={data} userId={userId} />
            <TermsSummary terms={data.currentTerms} lenderName={data.lenderName} borrowerName={data.borrowerName} />
          </Card>

          {(data.status === 'negotiating' || data.status === 'agreed') && (
            <Card>
              <LoanActions loan={data} userId={userId} onChanged={reload} onCounter={() => setCountering(true)} />
            </Card>
          )}
        </>
      )}

      {data.history.length > 1 && <History loan={data} userId={userId} />}
    </div>
  )
}

function nameOf(loan: LoanDetail, userId: string, personId: string): string {
  if (personId === userId) return 'You'
  return personId === loan.lenderId ? loan.lenderName : loan.borrowerName
}

function ProposalHeader({ terms, loan, userId }: { terms: TermsVersion; loan: LoanDetail; userId: string }) {
  const proposer = nameOf(loan, userId, terms.proposedBy)
  return (
    <div className="space-y-2">
      <p className="text-sm text-ink-muted">
        Version {terms.version}, proposed by {proposer} on {timestamp.format(new Date(terms.createdAt))}
      </p>
      {terms.message && (
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
