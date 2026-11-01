import { Link } from 'react-router'
import { formatDate } from '../../domain/dates'
import { formatCents } from '../../domain/money'
import { listLoans, type LoanSummary } from '../../data/loans'
import { useAsync } from '../../shared/useAsync'
import { Badge, Card, Notice, Spinner } from '../../shared/ui'
import { statusBadge } from './labels'

const OPEN = new Set(['negotiating', 'agreed', 'active'])

/** Home-screen list of loans, with anything waiting on the user first. */
export function LoansSection({ userId, canStartLoan }: { userId: string; canStartLoan: boolean }) {
  const [loans] = useAsync(() => listLoans(userId), userId)

  return (
    <Card>
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Loans</h2>
        {canStartLoan && (
          <Link
            to="/loans/new"
            className="inline-flex min-h-9 items-center rounded-xl bg-brand px-3 text-sm font-medium text-white hover:bg-brand/90"
          >
            New loan
          </Link>
        )}
      </div>

      {loans.status === 'loading' && <Spinner label="Loading loans…" />}
      {loans.status === 'error' && <Notice tone="error">{loans.error.message}</Notice>}
      {loans.status === 'success' && <LoanList loans={loans.data} />}
    </Card>
  )
}

function LoanList({ loans }: { loans: LoanSummary[] }) {
  if (loans.length === 0) {
    return <p className="mt-2 text-sm text-ink-muted">No loans yet.</p>
  }

  const open = loans.filter((l) => OPEN.has(l.status)).sort((a, b) => Number(b.awaitingMe) - Number(a.awaitingMe))
  const closed = loans.filter((l) => !OPEN.has(l.status))

  return (
    <div className="mt-3 space-y-4">
      {open.length > 0 && <Rows loans={open} />}
      {closed.length > 0 && (
        <details>
          <summary className="cursor-pointer text-sm text-ink-muted">Closed ({closed.length})</summary>
          <Rows loans={closed} />
        </details>
      )}
    </div>
  )
}

function Rows({ loans }: { loans: LoanSummary[] }) {
  return (
    <ul className="divide-y divide-line">
      {loans.map((loan) => {
        const overdue = loan.status === 'active' && (loan.balance?.overdueCount ?? 0) > 0
        const badge = overdue ? { label: 'Overdue', tone: 'danger' as const } : statusBadge(loan.status, loan.role, loan.awaitingMe)
        return (
          <li key={loan.id}>
            <Link to={`/loans/${loan.id}`} className="flex items-center justify-between gap-3 py-3 hover:opacity-80">
              <div>
                <p className="font-medium">
                  {loan.role === 'lender' ? `To ${loan.otherPersonName}` : `From ${loan.otherPersonName}`}
                </p>
                <p className="text-xs text-ink-muted tabular-nums">{summaryLine(loan)}</p>
              </div>
              <Badge tone={badge.tone}>{badge.label}</Badge>
            </Link>
          </li>
        )
      })}
    </ul>
  )
}

/** One line of figures: owed and next due for funded loans, the terms otherwise. */
function summaryLine(loan: LoanSummary): string {
  const balance = loan.balance
  if (loan.status === 'active' && balance) {
    const next = balance.nextDueOn ? ` · next due ${formatDate(balance.nextDueOn)}` : ''
    return `${formatCents(balance.outstandingCents)} owed of ${formatCents(balance.totalCents)}${next}`
  }
  if (loan.status === 'completed') return `${formatCents(loan.totalCents)} repaid`
  if (loan.status === 'written_off' && balance) return `${formatCents(balance.writtenOffCents)} forgiven`
  const first = loan.firstDueOn ? ` · first due ${formatDate(loan.firstDueOn)}` : ''
  return `${formatCents(loan.principalCents)} · repay ${formatCents(loan.totalCents)}${first}`
}
