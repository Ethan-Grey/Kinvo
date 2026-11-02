import { useMemo, useState, type FormEvent } from 'react'
import { addDays, isIsoDate, todayInNZ, type IsoDate } from '../../domain/dates'
import { formatCents, parseDollars, sumCents, toCents, ZERO, type Cents } from '../../domain/money'
import {
  buildSchedule,
  chargePercent,
  MAX_INSTALMENTS,
  validateTerms,
  type Frequency,
  type Instalment,
} from '../../domain/schedule'
import type { TermsInput } from '../../data/loans'
import { Button, Notice, Select, TextArea, TextField } from '../../shared/ui'
import { describeProblem } from './labels'

/** A schedule row as typed: the amount stays text until submitted. */
interface Row {
  dueOn: string
  amountText: string
}

const FREQUENCIES: { value: Frequency; label: string }[] = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'fortnightly', label: 'Fortnightly' },
  { value: 'monthly', label: 'Monthly' },
]

const COUNT_OPTIONS = Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }))

interface TermsFormProps {
  /** Pre-fills the form, e.g. with the terms being countered. */
  initial?: TermsInput
  submitLabel: string
  messageLabel: string
  onSubmit: (input: TermsInput) => Promise<void>
  onCancel?: () => void
}

function centsToText(cents: Cents): string {
  return (cents / 100).toFixed(2).replace(/\.00$/, '')
}

function rowsFrom(instalments: readonly Instalment[]): Row[] {
  return instalments.map((i) => ({ dueOn: i.dueOn, amountText: centsToText(i.amountCents) }))
}

/**
 * The amount, charge and repayment schedule for a proposal. Used for new
 * requests and offers, and for counter-offers.
 *
 * The schedule is built automatically from "N payments, every week, from
 * <date>". Editing any row switches to manual mode until rebuilt.
 */
export function TermsForm({ initial, submitLabel, messageLabel, onSubmit, onCancel }: TermsFormProps) {
  const today = todayInNZ()

  const [principalText, setPrincipalText] = useState(initial ? centsToText(initial.principalCents) : '')
  const [chargeText, setChargeText] = useState(initial ? centsToText(initial.chargeCents) : '0')
  const [count, setCount] = useState(String(initial?.instalments.length || 1))
  const [frequency, setFrequency] = useState<Frequency>('weekly')
  const [firstDueOn, setFirstDueOn] = useState<string>(initial?.instalments[0]?.dueOn ?? addDays(today, 7))
  const [manualRows, setManualRows] = useState<Row[] | null>(initial ? rowsFrom(initial.instalments) : null)
  const [lateTerms, setLateTerms] = useState(initial?.lateTerms ?? '')
  const [conditions, setConditions] = useState(initial?.conditions ?? '')
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showProblems, setShowProblems] = useState(false)

  const principal = parseDollars(principalText)
  const charge = parseDollars(chargeText || '0')
  const principalCents = principal.ok ? principal.cents : ZERO
  const chargeCents = charge.ok ? charge.cents : ZERO
  const totalCents = toCents(principalCents + chargeCents)

  // The automatic schedule, recalculated whenever its inputs change.
  const autoRows = useMemo<Row[]>(() => {
    const n = Number(count)
    if (totalCents < n || !isIsoDate(firstDueOn)) return []
    return rowsFrom(buildSchedule({ totalCents, count: n, frequency, firstDueOn }))
  }, [totalCents, count, frequency, firstDueOn])

  const rows = manualRows ?? autoRows

  const instalments: Instalment[] = rows.map((row) => {
    const parsed = parseDollars(row.amountText)
    return { dueOn: row.dueOn, amountCents: parsed.ok ? parsed.cents : ZERO }
  })
  const scheduleTotal = sumCents(instalments.map((i) => i.amountCents))

  const fieldErrors = [
    !principal.ok || principalCents === 0 ? 'Enter the amount to borrow.' : null,
    !charge.ok ? 'Enter the charge in dollars, or 0.' : null,
  ].filter((e): e is string => e !== null)

  const problems = fieldErrors.length > 0 ? [] : validateTerms({ principalCents, chargeCents, instalments }, today)

  function editRow(index: number, patch: Partial<Row>) {
    setManualRows(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setShowProblems(true)
    setError(null)
    if (fieldErrors.length > 0 || problems.length > 0) return

    setSubmitting(true)
    try {
      await onSubmit({ principalCents, chargeCents, instalments, lateTerms, conditions, message })
    } catch (err) {
      setError((err as Error).message)
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5" noValidate>
      <div className="grid grid-cols-2 gap-3">
        <TextField
          label="Amount to borrow ($)"
          inputMode="decimal"
          required
          value={principalText}
          onChange={(e) => setPrincipalText(e.target.value)}
          placeholder="200"
        />
        <TextField
          label="One-off charge ($)"
          inputMode="decimal"
          value={chargeText}
          onChange={(e) => setChargeText(e.target.value)}
          placeholder="0"
          hint={principal.ok && charge.ok && principalCents > 0 ? `${chargePercent(principalCents, chargeCents)} of the amount borrowed` : undefined}
        />
      </div>

      <div className="flex items-baseline justify-between rounded-xl bg-brand-soft px-4 py-3">
        <span className="text-sm">Total to repay</span>
        <span className="text-lg font-semibold tabular-nums text-brand-ink">{formatCents(totalCents)}</span>
      </div>

      <fieldset className="min-w-0 space-y-3">
        <legend className="text-sm font-semibold">Repayments</legend>

        {manualRows === null ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Select label="Payments" options={COUNT_OPTIONS} value={count} onChange={(e) => setCount(e.target.value)} />
            <Select
              label="How often"
              options={FREQUENCIES}
              value={frequency}
              onChange={(e) => setFrequency(e.target.value as Frequency)}
            />
            <TextField
              label="First due"
              type="date"
              min={today}
              value={firstDueOn}
              onChange={(e) => setFirstDueOn(e.target.value)}
              className="col-span-2 sm:col-span-1"
            />
          </div>
        ) : (
          <div className="flex items-center justify-between text-sm text-ink-muted">
            <span>Editing payments by hand.</span>
            <Button variant="ghost" onClick={() => setManualRows(null)}>
              Rebuild evenly
            </Button>
          </div>
        )}

        <ol className="space-y-2">
          {rows.map((row, index) => (
            <li key={index} className="flex items-end gap-2">
              <span className="mb-3 w-6 text-sm text-ink-muted tabular-nums">{index + 1}.</span>
              <TextField
                label="Due"
                type="date"
                min={today}
                value={row.dueOn}
                onChange={(e) => editRow(index, { dueOn: e.target.value })}
                className="min-w-0 flex-1"
              />
              <TextField
                label="Amount ($)"
                inputMode="decimal"
                value={row.amountText}
                onChange={(e) => editRow(index, { amountText: e.target.value })}
                className="w-24"
              />
              {manualRows !== null && rows.length > 1 && (
                <Button
                  variant="ghost"
                  aria-label={`Remove payment ${index + 1}`}
                  onClick={() => setManualRows(rows.filter((_, i) => i !== index))}
                >
                  ✕
                </Button>
              )}
            </li>
          ))}
        </ol>

        {rows.length > 0 && rows.length < MAX_INSTALMENTS && (
          <Button
            variant="secondary"
            onClick={() =>
              setManualRows([
                ...rows,
                { dueOn: addDays((rows.at(-1)?.dueOn as IsoDate) || today, 7), amountText: '' },
              ])
            }
          >
            Add a payment
          </Button>
        )}

        <p className={`text-sm tabular-nums ${scheduleTotal === totalCents ? 'text-ink-muted' : 'text-danger'}`}>
          Payments add up to {formatCents(scheduleTotal)} of {formatCents(totalCents)}.
        </p>
      </fieldset>

      <TextArea
        label="If a payment is late (optional)"
        maxLength={1000}
        value={lateTerms}
        onChange={(e) => setLateTerms(e.target.value)}
        placeholder="e.g. Let me know before the due date and we’ll sort out a new date."
        hint="Plain words both of you agree to. Kinvo never adds late fees automatically."
      />
      <TextArea
        label="Other conditions (optional)"
        maxLength={2000}
        value={conditions}
        onChange={(e) => setConditions(e.target.value)}
      />
      <TextArea
        label={messageLabel}
        maxLength={500}
        rows={2}
        value={message}
        onChange={(e) => setMessage(e.target.value)}
      />

      {showProblems && (fieldErrors.length > 0 || problems.length > 0) && (
        <Notice tone="error">
          <ul className="list-inside list-disc space-y-0.5">
            {[...fieldErrors, ...dedupe(problems.map(describeProblem))].map((text) => (
              <li key={text}>{text}</li>
            ))}
          </ul>
        </Notice>
      )}
      {error && <Notice tone="error">{error}</Notice>}

      <div className="flex gap-2">
        <Button type="submit" busy={submitting} className="flex-1">
          {submitLabel}
        </Button>
        {onCancel && (
          <Button variant="secondary" onClick={onCancel} disabled={submitting}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  )
}

function dedupe(items: string[]): string[] {
  return [...new Set(items)]
}
