import { useState } from 'react'
import { formatDate, formatShortDate } from '../../domain/dates'
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
import { ActionBar, ChoiceSheet, type Choice } from '../../shared/ActionBar'
import { useAsync } from '../../shared/useAsync'
import { RingAvatar } from '../../shared/Avatar'
import { CheckIcon, ChevronIcon, DocumentIcon } from '../../shared/icons'
import { Badge, Button, ButtonLink, Card, Notice, Skeleton, TextField } from '../../shared/ui'
import { methodLabel } from '../loans/labels'
import { ReceiptButton } from './ReceiptViewer'

interface PanelProps {
  loan: LoanDetail
  /** Called after anything that may change the loan's status (e.g. completion). */
  onLoanChanged: () => void
}

/** Balance, schedule progress, payments and actions for a funded loan (M4). */
export function RepaymentsPanel({ loan, onLoanChanged }: PanelProps) {
  const [data, reload] = useAsync(async () => {
    const [balance, progress, repayments] = await Promise.all([
      getBalance(loan.id),
      getInstalmentProgress(loan.id),
      listRepayments(loan.id),
    ])
    return { balance, progress, repayments }
  }, `${loan.id}:${loan.status}`)

  if (data.status === 'loading') {
    return (
      <div role="status" aria-label="Loading payments" className="space-y-5">
        <Skeleton className="h-44 rounded-3xl" />
        <Skeleton className="h-32 rounded-3xl" />
      </div>
    )
  }
  if (data.status === 'error') return <Notice tone="error">{data.error.message}</Notice>

  const { balance, progress, repayments } = data.data
  if (!balance) return null

  const isLender = loan.role === 'lender'
  const isActive = loan.status === 'active'
  const pending = repayments.filter((r) => r.status === 'claimed' || r.status === 'disputed')
  const settled = repayments.filter((r) => r.status === 'confirmed' || r.status === 'reversed')

  function changed() {
    reload()
    onLoanChanged()
  }

  return (
    <div className="space-y-5">
      <BalanceCard balance={balance} loan={loan} />

      {pending.length > 0 && (
        <Card className="space-y-3">
          <h2 className="text-lg font-semibold">
            {isLender ? 'Waiting for you to confirm' : 'Waiting for confirmation'}
          </h2>
          {pending.map((repayment) => (
            <PendingClaim
              key={repayment.id}
              repayment={repayment}
              isLender={isLender}
              isActive={isActive}
              onChanged={changed}
            />
          ))}
        </Card>
      )}

      <Card>
        <h2 className="text-lg font-semibold">Schedule</h2>
        <ScheduleProgress progress={progress} />
      </Card>

      {(settled.length > 0 || loan.fundsSentOn) && (
        <details className="group rounded-3xl border border-line bg-surface p-5">
          <summary className="flex cursor-pointer list-none items-center justify-between font-display text-lg font-semibold">
            History
            <ChevronIcon className="size-4 text-ink-muted transition-transform group-open:rotate-90" />
          </summary>
          <ul className="mt-2 divide-y divide-line">
            {settled.map((repayment) => (
              <SettledPayment
                key={repayment.id}
                repayment={repayment}
                canReverse={
                  isLender &&
                  (loan.status === 'active' || loan.status === 'completed') &&
                  repayment.status === 'confirmed'
                }
                onChanged={changed}
              />
            ))}
            {loan.fundsSentOn && <PaidOut loan={loan} />}
          </ul>
        </details>
      )}

      <FundedActionBar loan={loan} outstandingCents={balance.outstandingCents} onChanged={changed} />
    </div>
  )
}

function BalanceCard({ balance, loan }: { balance: LoanBalance; loan: LoanDetail }) {
  const share = balance.totalCents === 0 ? 0 : balance.paidCents / balance.totalCents
  const percent = Math.round(share * 100)
  const otherName = loan.role === 'lender' ? loan.borrowerName : loan.lenderName
  const writtenOff = loan.status === 'written_off'
  return (
    <Card className="space-y-4">
      <div className="flex items-center gap-4">
        <RingAvatar
          name={otherName}
          photo={loan.role === 'lender' ? loan.borrowerPhoto : loan.lenderPhoto}
          progress={share}
          overdue={balance.overdueCount > 0}
          size="xl"
        />
        <div className="min-w-0">
          <p className="text-sm text-ink-muted">{writtenOff ? 'Forgiven' : 'Still owed'}</p>
          <p className="font-display text-[2.5rem] leading-none font-semibold tabular-nums text-brand-ink">
            {formatCents(writtenOff ? balance.writtenOffCents : balance.outstandingCents)}
          </p>
          <p className="mt-1 text-sm text-ink-muted tabular-nums">
            Paid {formatCents(balance.paidCents)} of {formatCents(balance.totalCents)}
          </p>
        </div>
      </div>
      <div
        className="h-2 overflow-hidden rounded-full bg-ring-track"
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Paid back"
      >
        <div
          className="h-full rounded-full bg-brand-ink transition-[width] duration-700"
          style={{ width: `${percent}%` }}
        />
      </div>
      {balance.overdueCount > 0 && (
        <Notice tone="error">
          {formatCents(balance.overdueCents)} is overdue ({balance.overdueCount} payment
          {balance.overdueCount === 1 ? '' : 's'}).
        </Notice>
      )}
      {loan.status === 'completed' && <Notice tone="success">All paid back. 🎉</Notice>}
      {loan.status === 'active' && balance.nextDueOn && balance.nextDueCents !== null && balance.overdueCount === 0 && (
        <p className="text-sm">
          Next: <span className="font-semibold tabular-nums">{formatCents(balance.nextDueCents)}</span> due{' '}
          {formatShortDate(balance.nextDueOn)}
        </p>
      )}
    </Card>
  )
}

/** The schedule as a timeline: a filled dot when paid, red when overdue. */
function ScheduleProgress({ progress }: { progress: InstalmentProgress[] }) {
  return (
    <ol className="mt-3 tabular-nums">
      {progress.map((p, index) => {
        const last = index === progress.length - 1
        const dot =
          p.status === 'paid'
            ? 'bg-brand text-on-brand'
            : p.status === 'overdue'
              ? 'bg-danger text-on-danger'
              : 'border-2 border-line bg-surface'
        return (
          <li key={p.sequence} className="relative flex gap-3 pb-4 last:pb-0">
            {!last && <span aria-hidden="true" className="absolute top-7 bottom-0 left-[13px] w-0.5 bg-line" />}
            <span
              aria-hidden="true"
              className={`z-10 flex size-7 shrink-0 items-center justify-center rounded-full ${dot}`}
            >
              {p.status === 'paid' && <CheckIcon className="size-4" />}
            </span>
            <div className="flex min-w-0 flex-1 items-start justify-between gap-3">
              <div>
                <p className="font-medium">{formatDate(p.dueOn)}</p>
                <p className="text-sm text-ink-muted">
                  {p.status === 'paid'
                    ? `Paid${p.paidOn ? ` ${formatDate(p.paidOn)}` : ''}`
                    : p.paidCents > 0
                      ? `${formatCents(p.paidCents)} paid, ${formatCents(p.remainingCents)} left`
                      : 'Not paid yet'}
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <span className="font-semibold">{formatCents(p.amountCents)}</span>
                <Badge tone={p.status === 'paid' ? 'positive' : p.status === 'overdue' ? 'danger' : 'neutral'}>
                  {p.status === 'paid' ? 'Paid' : p.status === 'overdue' ? 'Overdue' : 'Due'}
                </Badge>
              </div>
            </div>
          </li>
        )
      })}
    </ol>
  )
}

function PaymentLine({ repayment }: { repayment: Repayment }) {
  return (
    <div className="min-w-0">
      <p className="font-display text-lg font-semibold tabular-nums">{formatCents(repayment.amountCents)}</p>
      <p className="text-sm text-ink-muted">
        {methodLabel(repayment.method)} on {formatShortDate(repayment.receivedOn)}
        {repayment.reference ? `, ref ${repayment.reference}` : ''}
      </p>
      {repayment.notes && <p className="text-sm text-ink-muted">“{repayment.notes}”</p>}
      {repayment.receiptPath && (
        <ReceiptButton
          path={repayment.receiptPath}
          label={`receipt for ${formatCents(repayment.amountCents)} on ${formatShortDate(repayment.receivedOn)}`}
          className="mt-1 inline-flex min-h-9 items-center gap-1.5 text-sm font-semibold text-brand-ink hover:underline"
        >
          <DocumentIcon className="size-4" />
          View receipt
        </ReceiptButton>
      )}
    </div>
  )
}

/** The money that started it, with its receipt. */
function PaidOut({ loan }: { loan: LoanDetail }) {
  if (!loan.fundsSentOn) return null
  return (
    <li className="py-3">
      <p className="font-display text-lg font-semibold tabular-nums">{formatCents(loan.currentTerms.principalCents)}</p>
      <p className="text-sm text-ink-muted">
        Paid out by {loan.lenderName.split(' ')[0]}
        {loan.fundsMethod ? `, ${methodLabel(loan.fundsMethod).toLowerCase()}` : ''} on{' '}
        {formatShortDate(loan.fundsSentOn)}
      </p>
      {loan.fundsReceiptPath && (
        <ReceiptButton
          path={loan.fundsReceiptPath}
          label={`receipt for the ${formatCents(loan.currentTerms.principalCents)} paid out`}
          className="mt-1 inline-flex min-h-9 items-center gap-1.5 text-sm font-semibold text-brand-ink hover:underline"
        >
          <DocumentIcon className="size-4" />
          View receipt
        </ReceiptButton>
      )}
    </li>
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
    <div className="space-y-2 rounded-2xl border border-line p-3">
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
          <TextField
            label="What’s wrong?"
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Not in my account yet"
          />
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
  onChanged,
}: {
  repayment: Repayment
  canReverse: boolean
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
      {reversed && repayment.reversalReason && (
        <p className="text-xs text-ink-muted">Reversed: {repayment.reversalReason}</p>
      )}
      {reversing && (
        <div className="space-y-2">
          <TextField
            label="Why undo this payment?"
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Entered twice"
          />
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

/** Pay or record a payment, with everything else behind "More". */
function FundedActionBar({
  loan,
  outstandingCents,
  onChanged,
}: {
  loan: LoanDetail
  outstandingCents: number
  onChanged: () => void
}) {
  const [sheet, setSheet] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const isLender = loan.role === 'lender'
  const owing = loan.status === 'active' && outstandingCents > 0
  const left = formatCents(toCents(outstandingCents))

  const more: Choice[] = isLender
    ? [
        ...(owing
          ? [
              { label: 'Change dates', hint: 'Move when payments are due', to: `/loans/${loan.id}/schedule` },
              {
                label: `Forgive the rest (${left})`,
                hint: `${loan.borrowerName.split(' ')[0]} won’t owe anything more. Can’t be undone.`,
                danger: true,
                run: async () => {
                  setError(null)
                  try {
                    await forgiveRemaining(loan.id, '')
                    onChanged()
                  } catch (err) {
                    setError((err as Error).message)
                  }
                },
              },
            ]
          : []),
        {
          label: 'Remove it completely',
          hint: 'For a test or a mistake',
          danger: true,
          to: `/loans/${loan.id}/remove`,
        },
      ]
    : []

  if (!owing && more.length === 0) return null
  return (
    <>
      {error && <Notice tone="error">{error}</Notice>}
      <ActionBar>
        {more.length > 0 && (
          <Button variant="secondary" onClick={() => setSheet(true)} aria-haspopup="dialog">
            More
          </Button>
        )}
        {owing && <ButtonLink to={`/loans/${loan.id}/pay`}>{isLender ? 'Record payment' : 'I’ve paid'}</ButtonLink>}
      </ActionBar>
      <ChoiceSheet open={sheet} title="More" choices={more} onClose={() => setSheet(false)} />
    </>
  )
}
