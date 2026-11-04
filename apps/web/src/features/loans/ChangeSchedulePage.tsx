import { useState, type FormEvent } from 'react'
import { addDays, formatDate, isIsoDate, todayInNZ } from '../../domain/dates'
import { formatCents, sumCents, toCents } from '../../domain/money'
import {
  amountOf,
  centsToText,
  isUnchanged,
  scheduleProblems,
  shiftUnpaid,
  SHIFT_LABELS,
  splitEvenly,
  toInstalments,
  type ScheduleRow,
  type Shift,
} from '../../domain/reschedule'
import { rescheduleLoan, type LoanDetail } from '../../data/loans'
import { getInstalmentProgress, type InstalmentProgress } from '../../data/repayments'
import { CheckIcon, CloseIcon, PlusIcon } from '../../shared/icons'
import { useAsync } from '../../shared/useAsync'
import { Button, Card, Notice, PageSkeleton, TextField } from '../../shared/ui'
import { LoanStep } from './LoanStepPages'

/**
 * /loans/:id/schedule — lender only, on an active loan: change when payments
 * are due and how much each one is. Takes effect straight away; the borrower
 * is told (ADR-0018).
 */
export function ChangeSchedulePage() {
  return (
    <LoanStep title={() => 'Change dates or amounts'}>
      {(loan, done) =>
        loan.role !== 'lender' ? (
          <Notice>Only the person who’s owed can change the schedule.</Notice>
        ) : loan.status !== 'active' ? (
          <Notice>The schedule can only be changed while it’s being paid back.</Notice>
        ) : (
          <ScheduleLoader loan={loan} onDone={done} />
        )
      }
    </LoanStep>
  )
}

function ScheduleLoader({ loan, onDone }: { loan: LoanDetail; onDone: (flash: string) => void }) {
  const [progress] = useAsync(() => getInstalmentProgress(loan.id), `${loan.id}:${loan.currentTerms.id}`)
  if (progress.status === 'loading') return <PageSkeleton label="Loading schedule" />
  if (progress.status === 'error') return <Notice tone="error">{progress.error.message}</Notice>
  return <ScheduleEditor key={loan.currentTerms.id} loan={loan} progress={progress.data} onDone={onDone} />
}

let nextKey = 0
const newKey = () => `row-${++nextKey}`

function rowsFrom(progress: InstalmentProgress[]): ScheduleRow[] {
  return progress.map((p) => ({
    key: newKey(),
    dueOn: p.dueOn,
    amountText: centsToText(p.amountCents),
    paidCents: p.paidCents,
    locked: p.status === 'paid',
  }))
}

export function ScheduleEditor({
  loan,
  progress,
  onDone,
}: {
  loan: LoanDetail
  progress: InstalmentProgress[]
  onDone: (flash: string) => void
}) {
  const totalCents = loan.currentTerms.totalCents
  const first = loan.borrowerName.split(' ')[0]
  const [rows, setRows] = useState<ScheduleRow[]>(() => rowsFrom(progress))
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tried, setTried] = useState(false)

  const lockedCents = sumCents(rows.filter((r) => r.locked).map(amountOf))
  const toScheduleCents = toCents(totalCents - lockedCents)
  const openCents = sumCents(rows.filter((r) => !r.locked).map(amountOf))
  const problems = scheduleProblems(rows, totalCents)
  const unchanged = isUnchanged(rows, loan.currentTerms.instalments)
  const hasOpen = rows.some((r) => !r.locked)

  function edit(key: string, patch: Partial<ScheduleRow>) {
    setRows((current) => current.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  }

  function addPayment() {
    setRows((current) => {
      const last = current.at(-1)?.dueOn ?? ''
      const dueOn = addDays(isIsoDate(last) ? last : todayInNZ(), 7)
      return [...current, { key: newKey(), dueOn, amountText: '', paidCents: toCents(0), locked: false }]
    })
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setTried(true)
    if (problems.length > 0 || unchanged) return
    setBusy(true)
    setError(null)
    try {
      await rescheduleLoan(loan.id, loan.currentTerms.id, toInstalments(rows), note)
      onDone(`Schedule changed. ${first} has been told.`)
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5" noValidate>
      <p className="text-ink-muted">
        {first} owes {formatCents(totalCents)} in total. Change any payment that isn’t paid yet. It takes effect
        straight away and {first} gets a notification.
      </p>

      {hasOpen && (
        <Card className="space-y-3">
          <h2 className="font-semibold">Move every unpaid payment</h2>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(SHIFT_LABELS) as Shift[]).map((by) => (
              <Button key={by} variant="secondary" onClick={() => setRows((r) => shiftUnpaid(r, by))}>
                {SHIFT_LABELS[by]} later
              </Button>
            ))}
            <Button variant="secondary" onClick={() => setRows((r) => shiftUnpaid(r, '1w', -1))}>
              1 week earlier
            </Button>
          </div>
        </Card>
      )}

      <section className="space-y-3" aria-labelledby="payments-heading">
        <h2 id="payments-heading" className="text-lg font-semibold">
          Payments
        </h2>
        <ol className="space-y-3">
          {rows.map((row, index) =>
            row.locked ? (
              <li key={row.key} className="flex items-center gap-3 rounded-2xl border border-line px-4 py-3">
                <span
                  aria-hidden="true"
                  className="flex size-7 shrink-0 items-center justify-center rounded-full bg-brand text-on-brand"
                >
                  <CheckIcon className="size-4" />
                </span>
                <span className="flex-1">
                  <span className="font-medium">Payment {index + 1}</span>{' '}
                  <span className="text-sm text-ink-muted">{formatDate(row.dueOn)}, paid</span>
                </span>
                <span className="font-semibold tabular-nums">{formatCents(amountOf(row))}</span>
              </li>
            ) : (
              <li key={row.key} className="space-y-2 rounded-2xl border border-line p-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-medium">Payment {index + 1}</p>
                  {rows.filter((r) => !r.locked).length > 1 && row.paidCents === 0 && (
                    <Button
                      variant="ghost"
                      className="min-h-9 px-2"
                      aria-label={`Remove payment ${index + 1}`}
                      onClick={() => setRows((current) => current.filter((r) => r.key !== row.key))}
                    >
                      <CloseIcon className="size-4" />
                    </Button>
                  )}
                </div>
                <div className="flex gap-2">
                  <TextField
                    label="Due"
                    type="date"
                    value={row.dueOn}
                    onChange={(e) => edit(row.key, { dueOn: e.target.value })}
                    className="min-w-0 flex-1"
                  />
                  <TextField
                    label="Amount ($)"
                    inputMode="decimal"
                    value={row.amountText}
                    onChange={(e) => edit(row.key, { amountText: e.target.value })}
                    className="w-28"
                  />
                </div>
                {row.paidCents > 0 && (
                  <p className="text-xs text-ink-muted">{formatCents(row.paidCents)} already paid towards this.</p>
                )}
              </li>
            ),
          )}
        </ol>
        {rows.length < 52 && (
          <Button variant="secondary" onClick={addPayment}>
            <PlusIcon className="size-4" />
            Add a payment
          </Button>
        )}
      </section>

      <Card className="space-y-2">
        <p className="flex justify-between gap-3 tabular-nums">
          <span>Unpaid payments add up to</span>
          <span className={`font-semibold ${openCents === toScheduleCents ? '' : 'text-danger'}`}>
            {formatCents(openCents)}
          </span>
        </p>
        <p className="flex justify-between gap-3 text-sm text-ink-muted tabular-nums">
          <span>Still to pay</span>
          <span>{formatCents(toScheduleCents)}</span>
        </p>
        {openCents !== toScheduleCents && hasOpen && (
          <Button variant="secondary" className="w-full" onClick={() => setRows((r) => splitEvenly(r, totalCents))}>
            Split {formatCents(toScheduleCents)} evenly
          </Button>
        )}
      </Card>

      <TextField
        label={`Note to ${first} (optional)`}
        maxLength={500}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="e.g. Moved to your new pay day"
      />

      {tried && unchanged && <Notice>Nothing’s changed yet.</Notice>}
      {tried && problems.length > 0 && (
        <Notice tone="error">
          <ul className="space-y-1">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </Notice>
      )}
      {error && <Notice tone="error">{error}</Notice>}

      <Button type="submit" className="w-full" busy={busy}>
        Save new schedule
      </Button>
    </form>
  )
}
