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
import { CloseIcon, PlusIcon } from '../../shared/icons'
import { Button, Notice, Segmented, Select, TextArea, TextField } from '../../shared/ui'
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

/** One-tap charges, as a share of the amount borrowed. */
const CHARGE_PRESETS = [0, 10, 25, 50] as const

const COUNT_OPTIONS = Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }))

interface TermsFormProps {
  /** Pre-fills the form, e.g. with the terms being countered. */
  initial?: TermsInput
  submitLabel: string
  /** Label for the note to the other person. Omit to hide the field. */
  messageLabel?: string
  /**
   * 'existing_debt' records money already owed from before Kinvo: one amount
   * owed now, no charge (ADR-0012).
   */
  variant?: 'new' | 'existing_debt'
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
export function TermsForm({ initial, submitLabel, messageLabel, variant = 'new', onSubmit, onCancel }: TermsFormProps) {
  const isExistingDebt = variant === 'existing_debt'
  const today = todayInNZ()

  const [principalText, setPrincipalText] = useState(initial ? centsToText(initial.principalCents) : '')
  const [chargeText, setChargeText] = useState(initial ? centsToText(initial.chargeCents) : '0')
  // An existing debt has no separate charge: the amount owed is the total.
  const effectiveChargeText = variant === 'existing_debt' ? '0' : chargeText
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
  const charge = parseDollars(effectiveChargeText || '0')
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
    !principal.ok || principalCents === 0
      ? isExistingDebt
        ? 'Enter the amount they owe.'
        : 'Enter the amount to borrow.'
      : null,
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
      <div className={isExistingDebt ? '' : 'grid grid-cols-2 gap-3'}>
        <TextField
          label={isExistingDebt ? 'Amount they owe you now ($)' : 'Amount to borrow ($)'}
          inputMode="decimal"
          required
          value={principalText}
          onChange={(e) => setPrincipalText(e.target.value)}
          placeholder="200"
        />
        {!isExistingDebt && (
          <TextField
            label="One-off charge ($)"
            inputMode="decimal"
            value={chargeText}
            onChange={(e) => setChargeText(e.target.value)}
            placeholder="0"
            hint={
              principal.ok && charge.ok && principalCents > 0
                ? `${chargePercent(principalCents, chargeCents)} of the amount borrowed`
                : undefined
            }
          />
        )}
      </div>

      {!isExistingDebt && principal.ok && principalCents > 0 && (
        <div className="-mt-2 flex flex-wrap gap-2" role="group" aria-label="Quick charge">
          {CHARGE_PRESETS.map((percent) => {
            const presetCents = toCents(Math.round((principalCents * percent) / 100))
            const active = charge.ok && chargeCents === presetCents
            return (
              <button
                key={percent}
                type="button"
                aria-pressed={active}
                onClick={() => setChargeText(centsToText(presetCents))}
                className={
                  'min-h-9 rounded-full px-3 text-sm font-semibold transition focus-visible:outline-2 focus-visible:outline-brand-ink ' +
                  (active ? 'bg-brand text-on-brand' : 'border border-line hover:border-brand-ink')
                }
              >
                {percent === 0 ? 'No charge' : `${percent}%`}
              </button>
            )
          })}
        </div>
      )}

      {!isExistingDebt && (
        <div className="rounded-3xl bg-brand px-5 py-4 text-on-brand">
          <p className="text-sm text-on-brand-muted">Total to repay</p>
          <p className="font-display text-4xl leading-tight font-semibold tabular-nums">{formatCents(totalCents)}</p>
          <p className="text-sm text-on-brand-muted tabular-nums">
            {formatCents(principalCents)} borrowed + {formatCents(chargeCents)} charge
          </p>
        </div>
      )}

      <fieldset className="min-w-0 space-y-3">
        <legend className="font-display text-lg font-semibold">Repayment plan</legend>

        {manualRows === null ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <Select
                label="Payments"
                options={COUNT_OPTIONS}
                value={count}
                onChange={(e) => setCount(e.target.value)}
              />
              <TextField
                label="First due"
                type="date"
                min={today}
                value={firstDueOn}
                onChange={(e) => setFirstDueOn(e.target.value)}
              />
            </div>
            {count !== '1' && (
              <Segmented label="How often" options={FREQUENCIES} value={frequency} onChange={setFrequency} />
            )}
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
              <span
                aria-hidden="true"
                className="mb-2 flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-soft text-sm font-semibold text-on-brand-soft tabular-nums"
              >
                {index + 1}
              </span>
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
                  <CloseIcon className="size-4" />
                </Button>
              )}
            </li>
          ))}
        </ol>

        {rows.length > 0 && rows.length < MAX_INSTALMENTS && (
          <Button
            variant="secondary"
            onClick={() =>
              setManualRows([...rows, { dueOn: addDays((rows.at(-1)?.dueOn as IsoDate) || today, 7), amountText: '' }])
            }
          >
            <PlusIcon className="size-4" />
            Add a payment
          </Button>
        )}

        <p className={`text-sm tabular-nums ${scheduleTotal === totalCents ? 'text-ink-muted' : 'text-danger'}`}>
          Payments add up to {formatCents(scheduleTotal)} of {formatCents(totalCents)}.
        </p>
      </fieldset>

      <details
        open={Boolean(initial?.lateTerms || initial?.conditions)}
        className="group space-y-4 rounded-2xl border border-line p-4"
      >
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 font-semibold">
          Late payments and other conditions
          <span className="text-sm font-normal text-ink-muted group-open:hidden">Optional</span>
        </summary>
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
      </details>
      {messageLabel && (
        <TextArea
          label={messageLabel}
          maxLength={500}
          rows={2}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
      )}

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
