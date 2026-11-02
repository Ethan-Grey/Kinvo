import { useState } from 'react'
import { formatDate } from '../../domain/dates'
import { formatCents, toCents } from '../../domain/money'
import type { LoanDetail } from '../../data/loans'
import {
  confirmRepayment,
  disputeRepayment,
  forgiveRemaining,
  getBalance,
  getInstalmentProgress,
  listRepayments,
  reverseRepayment,
  type InstalmentProgress,
  type LoanBalance,
  type Repayment,
} from '../../data/repayments'
import { useAsync } from '../../shared/useAsync'
import { Badge, Button, Card, Notice, Spinner, TextField } from '../../shared/ui'
import { methodLabel } from '../loans/labels'
import { PaymentForm } from './PaymentForm'

interface PanelProps {
  loan: LoanDetail
  userId: string
  /** Called after anything that may change the loan's status (e.g. completion). */
  onLoanChanged: () => void
}

/** Balance, schedule progress, payments and actions for a funded loan (M4). */
export function RepaymentsPanel({ loan, userId, onLoanChanged }: PanelProps) {
  const [data, reload] = useAsync(async () => {
    const [balance, progress, repayments] = await Promise.all([
      getBalance(loan.id),
      getInstalmentProgress(loan.id),
      listRepayments(loan.id),
    ])
    return { balance, progress, repayments }
  }, `${loan.id}:${loan.status}`)

  if (data.status === 'loading') return <Spinner label="Loading payments…" />
  if (data.status === 'error') return <Notice tone="error">{data.error.message}</Notice>

  const { balance, progress, repayments } = data.data
  if (!balance) return null

  const isLender = loan.role === 'lender'
  const isActive = loan.status === 'active'
  const pending = repayments.filter((r) => r.status === 'claimed' || r.status === 'disputed')
  const settled = repayments.filter((r) => r.status === 'confirmed' || r.status === 'reversed')
  const nextUnpaid = progress.find((p) => p.status !== 'paid')

  function changed() {
    reload()
    onLoanChanged()
  }

  return (
    <div className="space-y-5">
      <BalanceCard balance={balance} loan={loan} />

      <Card>
        <h2 className="font-semibold">Schedule</h2>
        <ScheduleProgress progress={progress} />
      </Card>

      {pending.length > 0 && (
        <Card className="space-y-3">
          <h2 className="font-semibold">{isLender ? 'Waiting for you to confirm' : 'Waiting for confirmation'}</h2>
          {pending.map((repayment) => (
            <PendingClaim key={repayment.id} repayment={repayment} isLender={isLender} isActive={isActive} onChanged={changed} />
          ))}
        </Card>
      )}

      {isActive && balance.outstandingCents > 0 && (
        <Card>
          <PaymentForm
            loanId={loan.id}
            isLender={isLender}
            lenderName={loan.lenderName}
            outstandingCents={balance.outstandingCents}
            suggestedCents={toCents(Math.min(nextUnpaid?.remainingCents ?? 0, balance.outstandingCents))}
            earliestDate={loan.fundsSentOn ?? '2000-01-01'}
            onRecorded={changed}
          />
        </Card>
      )}

      {settled.length > 0 && (
        <Card>
          <h2 className="font-semibold">Payments</h2>
          <ul className="mt-2 divide-y divide-line">
            {settled.map((repayment) => (
              <SettledPayment
                key={repayment.id}
                repayment={repayment}
                canReverse={isLender && (loan.status === 'active' || loan.status === 'completed') && repayment.status === 'confirmed'}
                submittedByLabel={repayment.submittedBy === userId ? 'you' : repayment.submittedBy === loan.lenderId ? loan.lenderName : loan.borrowerName}
                onChanged={changed}
              />
            ))}
          </ul>
        </Card>
      )}

      {isLender && isActive && balance.outstandingCents > 0 && (
        <ForgiveButton loanId={loan.id} outstandingCents={balance.outstandingCents} borrowerName={loan.borrowerName} onChanged={changed} />
      )}
    </div>
  )
}

function BalanceCard({ balance, loan }: { balance: LoanBalance; loan: LoanDetail }) {
  const percent = balance.totalCents === 0 ? 0 : Math.round((balance.paidCents / balance.totalCents) * 100)
  return (
    <Card className="space-y-3">
      <div className="flex items-baseline justify-between">
        <span className="text-sm text-ink-muted">Paid {formatCents(balance.paidCents)} of {formatCents(balance.totalCents)}</span>
        <span className="text-sm font-medium tabular-nums">{percent}%</span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-brand-soft" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label="Repaid">
        <div className="h-full rounded-full bg-brand-ink transition-[width]" style={{ width: `${percent}%` }} />
      </div>
      <div className="flex items-baseline justify-between">
        <span className="font-medium">{loan.status === 'written_off' ? 'Forgiven' : 'Still owed'}</span>
        <span className="text-2xl font-semibold tabular-nums text-brand-ink">
          {formatCents(loan.status === 'written_off' ? balance.writtenOffCents : balance.outstandingCents)}
        </span>
      </div>
      {balance.overdueCount > 0 && (
        <Notice tone="error">
          {formatCents(balance.overdueCents)} is overdue ({balance.overdueCount} payment{balance.overdueCount === 1 ? '' : 's'}).
        </Notice>
      )}
      {loan.status === 'completed' && <Notice tone="success">Fully repaid. 🎉</Notice>}
      {loan.status === 'active' && balance.nextDueOn && balance.nextDueCents !== null && balance.overdueCount === 0 && (
        <p className="text-sm text-ink-muted">
          Next: {formatCents(balance.nextDueCents)} due {formatDate(balance.nextDueOn)}
        </p>
      )}
    </Card>
  )
}

function ScheduleProgress({ progress }: { progress: InstalmentProgress[] }) {
  return (
    <ul className="mt-2 divide-y divide-line text-sm tabular-nums">
      {progress.map((p) => (
        <li key={p.sequence} className="flex items-center justify-between gap-3 py-2.5">
          <div>
            <p>{formatDate(p.dueOn)}</p>
            <p className="text-xs text-ink-muted">
              {p.status === 'paid'
                ? `Paid${p.paidOn ? ` ${formatDate(p.paidOn)}` : ''}`
                : p.paidCents > 0
                  ? `${formatCents(p.paidCents)} paid, ${formatCents(p.remainingCents)} left`
                  : 'Not paid yet'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-medium">{formatCents(p.amountCents)}</span>
            <Badge tone={p.status === 'paid' ? 'positive' : p.status === 'overdue' ? 'danger' : 'neutral'}>
              {p.status === 'paid' ? 'Paid' : p.status === 'overdue' ? 'Overdue' : 'Due'}
            </Badge>
          </div>
        </li>
      ))}
    </ul>
  )
}

function PaymentLine({ repayment }: { repayment: Repayment }) {
  return (
    <div>
      <p className="font-medium tabular-nums">
        {formatCents(repayment.amountCents)}{' '}
        <span className="font-normal text-ink-muted">
          · {methodLabel(repayment.method)} · {formatDate(repayment.receivedOn)}
          {repayment.reference ? ` · ref ${repayment.reference}` : ''}
        </span>
      </p>
      {repayment.notes && <p className="text-xs text-ink-muted">“{repayment.notes}”</p>}
    </div>
  )
}

function PendingClaim({
  repayment,
  isLender,
  isActive,
  onChanged,
}: {
  repayment: Repayment
  isLender: boolean
  isActive: boolean
  onChanged: () => void
}) {
  const [disputing, setDisputing] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run(action: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await action()
      onChanged()
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2 rounded-xl border border-line p-3">
      <div className="flex items-start justify-between gap-2">
        <PaymentLine repayment={repayment} />
        <Badge tone={repayment.status === 'disputed' ? 'danger' : 'warning'}>
          {repayment.status === 'disputed' ? 'Disputed' : 'Claimed'}
        </Badge>
      </div>
      {repayment.disputeReason && <p className="text-sm text-danger">Disputed: {repayment.disputeReason}</p>}
      {error && <Notice tone="error">{error}</Notice>}

      {isLender && isActive && !disputing && (
        <div className="grid grid-cols-2 gap-2">
          <Button busy={busy} onClick={() => run(() => confirmRepayment(repayment.id))}>
            I received it
          </Button>
          {repayment.status === 'claimed' && (
            <Button variant="secondary" disabled={busy} onClick={() => setDisputing(true)}>
              Not received
            </Button>
          )}
        </div>
      )}
      {disputing && (
        <div className="space-y-2">
          <TextField label="What’s wrong?" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Not in my account yet" />
          <div className="grid grid-cols-2 gap-2">
            <Button variant="danger" busy={busy} onClick={() => run(() => disputeRepayment(repayment.id, reason))}>
              Dispute
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => setDisputing(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

function SettledPayment({
  repayment,
  canReverse,
  submittedByLabel,
  onChanged,
}: {
  repayment: Repayment
  canReverse: boolean
  submittedByLabel: string
  onChanged: () => void
}) {
  const [reversing, setReversing] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const reversed = repayment.status === 'reversed'

  async function handleReverse() {
    setBusy(true)
    setError(null)
    try {
      await reverseRepayment(repayment.id, reason)
      onChanged()
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  return (
    <li className={`space-y-2 py-3 ${reversed ? 'opacity-60' : ''}`}>
      <div className="flex items-start justify-between gap-2">
        <div className={reversed ? 'line-through' : ''}>
          <PaymentLine repayment={repayment} />
        </div>
        {reversed ? (
          <Badge>Reversed</Badge>
        ) : (
          canReverse &&
          !reversing && (
            <Button variant="ghost" onClick={() => setReversing(true)}>
              Undo
            </Button>
          )
        )}
      </div>
      <p className="text-xs text-ink-muted">Recorded by {submittedByLabel}</p>
      {reversed && repayment.reversalReason && <p className="text-xs text-ink-muted">Reversed: {repayment.reversalReason}</p>}
      {reversing && (
        <div className="space-y-2">
          <TextField label="Why undo this payment?" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Entered twice" />
          {error && <Notice tone="error">{error}</Notice>}
          <div className="grid grid-cols-2 gap-2">
            <Button variant="danger" busy={busy} onClick={handleReverse}>
              Undo payment
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => setReversing(false)}>
              Keep it
            </Button>
          </div>
        </div>
      )}
    </li>
  )
}

function ForgiveButton({
  loanId,
  outstandingCents,
  borrowerName,
  onChanged,
}: {
  loanId: string
  outstandingCents: number
  borrowerName: string
  onChanged: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleForgive() {
    if (!window.confirm(`Forgive the remaining ${formatCents(toCents(outstandingCents))}? ${borrowerName} won’t owe anything more on this loan. This can’t be undone.`)) {
      return
    }
    setBusy(true)
    try {
      await forgiveRemaining(loanId, '')
      onChanged()
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2">
      {error && <Notice tone="error">{error}</Notice>}
      <Button variant="ghost" className="w-full" busy={busy} onClick={handleForgive}>
        Forgive the rest ({formatCents(toCents(outstandingCents))})
      </Button>
    </div>
  )
}
