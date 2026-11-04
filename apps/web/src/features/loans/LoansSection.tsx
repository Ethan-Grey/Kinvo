import { Link } from 'react-router'
import { formatShortDate } from '../../domain/dates'
import { formatCents } from '../../domain/money'
import type { LoanSummary } from '../../data/loans'
import { RingAvatar } from '../../shared/Avatar'
import { ChevronIcon } from '../../shared/icons'
import { Badge } from '../../shared/ui'
import { OPEN_STATUSES, statusBadge } from './labels'

/**
 * Loans as tappable rows: the other person in their repayment ring, what's
 * owed, and the status. Anything waiting on you comes first.
 */
export function LoanList({ loans, showClosed = true }: { loans: LoanSummary[]; showClosed?: boolean }) {
  const open = loans
    .filter((l) => OPEN_STATUSES.has(l.status))
    .sort((a, b) => Number(b.awaitingMe) - Number(a.awaitingMe) || Number(isOverdue(b)) - Number(isOverdue(a)))
  const closed = loans.filter((l) => !OPEN_STATUSES.has(l.status))

  return (
    <div className="space-y-4">
      {open.length > 0 && <Rows loans={open} />}
      {showClosed && closed.length > 0 && (
        <details className="group">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1 text-sm font-medium text-ink-muted hover:text-ink">
            <ChevronIcon className="size-4 transition-transform group-open:rotate-90" />
            Closed ({closed.length})
          </summary>
          <div className="mt-2">
            <Rows loans={closed} />
          </div>
        </details>
      )}
    </div>
  )
}

function isOverdue(loan: LoanSummary): boolean {
  return loan.status === 'active' && (loan.balance?.overdueCount ?? 0) > 0
}

export function Rows({ loans }: { loans: LoanSummary[] }) {
  return (
    <ul className="space-y-2">
      {loans.map((loan) => {
        const overdue = isOverdue(loan)
        const badge = overdue
          ? { label: 'Overdue', tone: 'danger' as const }
          : statusBadge(loan.status, loan.role, loan.awaitingMe)
        const balance = loan.balance
        const progress = balance && balance.totalCents > 0 ? balance.paidCents / balance.totalCents : null
        const amount =
          loan.status === 'active' && balance
            ? balance.outstandingCents
            : loan.status === 'written_off' && balance
              ? balance.writtenOffCents
              : loan.totalCents
        return (
          <li key={loan.id}>
            <Link
              to={`/loans/${loan.id}`}
              className={
                'flex items-center gap-3 rounded-3xl border p-3 pr-4 transition hover:border-brand-ink active:scale-[0.99] ' +
                (loan.awaitingMe ? 'border-attention' : 'border-line')
              }
            >
              <RingAvatar
                name={loan.otherPersonName}
                photo={loan.otherPersonPhoto}
                progress={progress}
                overdue={overdue}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">
                  {loan.role === 'lender' ? `${loan.otherPersonName} owes you` : `You owe ${loan.otherPersonName}`}
                </p>
                <p className="truncate text-sm text-ink-muted tabular-nums">{summaryLine(loan)}</p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <span className="font-display text-lg leading-none font-semibold tabular-nums">
                  {formatCents(amount)}
                </span>
                <Badge tone={badge.tone}>{badge.label}</Badge>
              </div>
            </Link>
          </li>
        )
      })}
    </ul>
  )
}

/** One short line under the name; the big number on the right is what's owed (or the total). */
function summaryLine(loan: LoanSummary): string {
  const balance = loan.balance
  if (loan.status === 'active' && balance) {
    if (balance.overdueCount > 0 && balance.nextDueOn) return `Overdue since ${formatShortDate(balance.nextDueOn)}`
    return balance.nextDueOn
      ? `Next payment ${formatShortDate(balance.nextDueOn)}`
      : `${formatCents(balance.outstandingCents)} left of ${formatCents(balance.totalCents)}`
  }
  if (loan.status === 'completed') return 'Paid back in full'
  if (loan.status === 'written_off') return 'Forgiven'
  if (loan.kind === 'existing_debt') return 'Existing debt'
  return loan.firstDueOn
    ? `First payment ${formatShortDate(loan.firstDueOn)}`
    : `${formatCents(loan.principalCents)} proposed`
}
