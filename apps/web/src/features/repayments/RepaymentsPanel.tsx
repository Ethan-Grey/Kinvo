import { useState } from 'react'
import { Link } from 'react-router'
import { formatDate, formatShortDate } from '../../domain/dates'
import { formatCents, toCents, type Cents } from '../../domain/money'
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
import { RingAvatar } from '../../shared/Avatar'
import { CheckIcon, ChevronIcon, DocumentIcon, PaymentIcon } from '../../shared/icons'
import { Badge, Button, Card, Notice, Skeleton, TextField } from '../../shared/ui'
import { methodLabel } from '../loans/labels'
import { ReceiptButton } from './ReceiptViewer'
import { allocatePayments } from '../../domain/allocation'

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

      {isActive && balance.outstandingCents > 0 && (
        <Link
          to={`/loans/${loan.id}/pay`}
          className={
            'flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-brand px-5 font-semibold text-on-brand ' +
            'shadow-[0_6px_16px_-6px_rgb(97_61_193/0.6)] transition active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-ink'
          }
        >
          <PaymentIcon className="size-5" />
          {isLender ? 'Record a payment' : 'I’ve paid'}
        </Link>
      )}

      <Card>
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-lg font-semibold">Schedule</h2>
          {isLender && isActive && balance.outstandingCents > 0 && (
            <Link
              to={`/loans/${loan.id}/schedule`}
              className="text-sm font-semibold text-brand-ink hover:underline focus-visible:outline-2 focus-visible:outline-brand-ink"
            >
              Change dates
            </Link>
          )}
        </div>
        <ScheduleProgress progress={progress} />
      </Card>

      <ProofOfPayment loan={loan} repayments={repayments} progress={progress} />

      {settled.length > 0 && (
        <details className="group rounded-3xl border border-line bg-surface p-5">
          <summary className="flex cursor-pointer list-none items-center justify-between font-display text-lg font-semibold">
            Payment history
            <span className="font-sans text-sm font-normal text-ink-muted">{settled.length}</span>
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
                submittedByLabel={
                  repayment.submittedBy === userId
                    ? 'you'
                    : repayment.submittedBy === loan.lenderId
                      ? loan.lenderName
                      : loan.borrowerName
                }
                onChanged={changed}
              />
            ))}
          </ul>
        </details>
      )}

      {isLender && isActive && balance.outstandingCents > 0 && (
        <ForgiveButton
          loanId={loan.id}
          outstandingCents={balance.outstandingCents}
          borrowerName={loan.borrowerName}
          onChanged={changed}
        />
      )}
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
        aria-label="Repaid"
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
      {loan.status === 'completed' && <Notice tone="success">Fully repaid. 🎉</Notice>}
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

/**
 * Proof that money moved, for both people, in two parts: the money the lender
 * sent, and the payments back grouped by the instalment they paid off. Only
 * dates and amounts are listed; a receipt image loads when it's tapped, so a
 * loan with many payments stays quick to open.
 */
function ProofOfPayment({
  loan,
  repayments,
  progress,
}: {
  loan: LoanDetail
  repayments: Repayment[]
  progress: InstalmentProgress[]
}) {
  const lenderFirst = loan.lenderName.split(' ')[0]
  const borrowerFirst = loan.borrowerName.split(' ')[0]
  const waiting = repayments.filter((r) => r.status === 'claimed' || r.status === 'disputed')
  const byInstalment = allocatePayments(
    progress.map((p) => ({ sequence: p.sequence, amountCents: p.amountCents })),
    repayments.filter((r) => r.status === 'confirmed'),
  )

  return (
    <Card className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold">Proof of payment</h2>
        <p className="text-sm text-ink-muted">Tap a payment to see its receipt. Both of you can see these.</p>
      </div>

      {loan.fundsSentOn && (
        <section>
          <h3 className="font-sans text-sm font-semibold text-ink-muted">Money sent by {lenderFirst}</h3>
          <ul className="mt-2">
            <ProofRow
              path={loan.fundsReceiptPath}
              date={loan.fundsSentOn}
              amountCents={loan.currentTerms.principalCents}
              detail={loan.fundsMethod ? methodLabel(loan.fundsMethod) : null}
              cash={loan.fundsMethod === 'cash'}
            />
          </ul>
        </section>
      )}

      <section className="space-y-2">
        <h3 className="font-sans text-sm font-semibold text-ink-muted">Payments back from {borrowerFirst}</h3>

        {waiting.length > 0 && (
          <div className="rounded-2xl border border-attention p-3">
            <p className="text-sm font-semibold">Waiting to be confirmed</p>
            <ul className="mt-1">
              {waiting.map((r) => (
                <ProofRow
                  key={r.id}
                  path={r.receiptPath}
                  date={r.receivedOn}
                  amountCents={r.amountCents}
                  detail={r.status === 'disputed' ? 'Disputed' : methodLabel(r.method)}
                  cash={r.method === 'cash'}
                />
              ))}
            </ul>
          </div>
        )}

        <ul className="space-y-2">
          {progress.map((instalment) => {
            const paid = byInstalment.get(instalment.sequence) ?? []
            const receipts = paid.filter((a) => a.payment.receiptPath).length
            return (
              <li key={instalment.sequence}>
                <details className="group rounded-2xl border border-line">
                  <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 px-3 py-2">
                    <ChevronIcon className="size-4 shrink-0 text-ink-muted transition-transform group-open:rotate-90" />
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold">Payment {instalment.sequence}</span>
                      <span className="block text-sm text-ink-muted">
                        Due {formatShortDate(instalment.dueOn)}
                        {paid.length > 0 ? `, ${paid.length} payment${paid.length === 1 ? '' : 's'}` : ''}
                        {receipts > 0 ? `, ${receipts} receipt${receipts === 1 ? '' : 's'}` : ''}
                      </span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-1">
                      <span className="font-semibold tabular-nums">{formatCents(instalment.amountCents)}</span>
                      <Badge
                        tone={
                          instalment.status === 'paid'
                            ? 'positive'
                            : instalment.status === 'overdue'
                              ? 'danger'
                              : 'neutral'
                        }
                      >
                        {instalment.status === 'paid' ? 'Paid' : instalment.status === 'overdue' ? 'Overdue' : 'Due'}
                      </Badge>
                    </span>
                  </summary>
                  <div className="border-t border-line px-3 pb-2">
                    {paid.length === 0 ? (
                      <p className="py-3 text-sm text-ink-muted">Nothing paid towards this yet.</p>
                    ) : (
                      <ul>
                        {paid.map(({ payment, appliedCents }) => (
                          <ProofRow
                            key={payment.id}
                            path={payment.receiptPath}
                            date={payment.receivedOn}
                            amountCents={appliedCents}
                            detail={
                              appliedCents < payment.amountCents
                                ? `Part of ${formatCents(payment.amountCents)} paid`
                                : methodLabel(payment.method)
                            }
                            cash={payment.method === 'cash'}
                          />
                        ))}
                      </ul>
                    )}
                  </div>
                </details>
              </li>
            )
          })}
        </ul>
      </section>
    </Card>
  )
}

/** One movement of money: date and amount, opening its receipt when tapped. */
function ProofRow({
  path,
  date,
  amountCents,
  detail,
  cash,
}: {
  path: string | null
  date: string
  amountCents: Cents
  detail: string | null
  cash: boolean
}) {
  const text = (
    <>
      <span className="min-w-0 flex-1 text-left">
        <span className="block font-medium">{formatShortDate(date)}</span>{' '}
        <span className="block text-sm text-ink-muted">
          {[detail, path ? null : cash ? 'no receipt (cash)' : 'no receipt'].filter(Boolean).join(', ')}
        </span>
      </span>{' '}
      <span className="font-semibold tabular-nums">{formatCents(amountCents)}</span>
    </>
  )
  return (
    <li className="border-b border-line last:border-b-0">
      {path ? (
        <ReceiptButton
          path={path}
          label={`receipt for ${formatCents(amountCents)} on ${formatShortDate(date)}`}
          useLabel={false}
          className="flex min-h-14 w-full items-center gap-3 py-2 hover:opacity-80 focus-visible:outline-2 focus-visible:outline-brand-ink"
        >
          <span className="sr-only">View receipt: </span>
          {text}
          <DocumentIcon className="size-5 shrink-0 text-brand-ink" />
        </ReceiptButton>
      ) : (
        <div className="flex min-h-14 items-center gap-3 py-2">{text}</div>
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
    if (
      !window.confirm(
        `Forgive the remaining ${formatCents(toCents(outstandingCents))}? ${borrowerName} won’t owe anything more on this loan. This can’t be undone.`,
      )
    ) {
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
