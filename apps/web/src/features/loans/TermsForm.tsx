import { useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { addDays, formatDate, isIsoDate, todayInNZ, type IsoDate } from '../../domain/dates'
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
import { CountStepper, MoneyField, QuickPicks, WizardStep } from '../../shared/Wizard'
import { Button, Notice, Segmented, TextArea, TextField } from '../../shared/ui'
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

/** One-tap charges, as a share of the amount. */
const CHARGE_PRESETS = [0, 10, 25, 50] as const

type Step = 'amount' | 'reason' | 'charge' | 'plan' | 'review'

interface TermsFormProps {
  /** Pre-fills the form, e.g. with the terms being changed. */
  initial?: TermsInput
  /** Whose side the form is written from. Only changes the wording. */
  perspective?: 'borrower' | 'lender'
  submitLabel: string
  /** Label for the note to the other person. Omit to hide the field. */
  messageLabel?: string
  /**
   * 'existing_debt' records money already owed from before Kinvo: one amount
   * owed now, no charge (ADR-0012).
   */
  variant?: 'new' | 'existing_debt'
  /**
   * For borrowers: the charge is the lender's to set (ADR-0015). Given the
   * amount, returns the charge the proposal must carry, and the charge step
   * is skipped. Omit for lenders, who choose the charge themselves.
   */
  fixedCharge?: (principalCents: Cents) => Cents
  /** Extra fields for the review step, e.g. "What's it for?". */
  reviewExtras?: ReactNode
  /** Asks what the money is for, straight after the amount (required when asking to borrow). */
  reasonStep?: { value: string; onChange: (value: string) => void; title: string; hint?: string; required: boolean }
  /** Back from the first step, e.g. to choose a different person. */
  onBackFromStart?: () => void
  onSubmit: (input: TermsInput) => Promise<void>
}

function centsToText(cents: Cents): string {
  return (cents / 100).toFixed(2).replace(/\.00$/, '')
}

function rowsFrom(instalments: readonly Instalment[]): Row[] {
  return instalments.map((i) => ({ dueOn: i.dueOn, amountText: centsToText(i.amountCents) }))
}

/**
 * The amount, charge and repayment plan for a proposal, asked one step at a
 * time: how much, any charge, how it's paid back, then a review to send.
 * Used for new requests and offers, changes to terms, and existing debts.
 *
 * The plan is built automatically from "N payments, every week, from <date>".
 * Editing a payment by hand switches to manual mode until rebuilt.
 */
export function TermsForm({
  initial,
  perspective = 'borrower',
  fixedCharge,
  submitLabel,
  messageLabel,
  variant = 'new',
  reviewExtras,
  reasonStep,
  onBackFromStart,
  onSubmit,
}: TermsFormProps) {
  const isExistingDebt = variant === 'existing_debt'
  const today = todayInNZ()
  const choosesCharge = !isExistingDebt && !fixedCharge
  const steps: Step[] = [
    'amount',
    ...(reasonStep ? (['reason'] as const) : []),
    ...(choosesCharge ? (['charge'] as const) : []),
    'plan',
    'review',
  ]
  const [stepIndex, setStepIndex] = useState(0)
  const step = steps[stepIndex] ?? 'amount'

  const [principalText, setPrincipalText] = useState(initial ? centsToText(initial.principalCents) : '')
  const [chargeText, setChargeText] = useState(initial ? centsToText(initial.chargeCents) : '0')
  const [count, setCount] = useState(initial?.instalments.length || 1)
  const [start] = useState(() => startingPlan(initial))
  const [frequency, setFrequency] = useState<Frequency>(start.frequency)
  const [firstDueOn, setFirstDueOn] = useState<string>(initial?.instalments[0]?.dueOn ?? addDays(today, 7))
  const [manualRows, setManualRows] = useState<Row[] | null>(start.manual)
  // Kept as they were: the form no longer asks for late terms or conditions.
  const lateTerms = initial?.lateTerms ?? ''
  const conditions = initial?.conditions ?? ''
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [errors, setErrors] = useState<string[]>([])

  const principal = parseDollars(principalText)
  const principalCents = principal.ok ? principal.cents : ZERO
  const charge = parseDollars(choosesCharge ? chargeText || '0' : '0')
  const chargeCents = fixedCharge ? fixedCharge(principalCents) : charge.ok ? charge.cents : ZERO
  const totalCents = toCents(principalCents + chargeCents)

  // The automatic schedule, recalculated whenever its inputs change.
  const autoRows = useMemo<Row[]>(() => {
    if (totalCents < count || !isIsoDate(firstDueOn)) return []
    return rowsFrom(buildSchedule({ totalCents, count, frequency, firstDueOn }))
  }, [totalCents, count, frequency, firstDueOn])

  const rows = manualRows ?? autoRows
  const instalments: Instalment[] = rows.map((row) => {
    const parsed = parseDollars(row.amountText)
    return { dueOn: row.dueOn, amountCents: parsed.ok ? parsed.cents : ZERO }
  })
  const scheduleTotal = sumCents(instalments.map((i) => i.amountCents))

  function problemsFor(s: Step): string[] {
    if (s === 'amount') {
      return !principal.ok || principalCents === 0
        ? [isExistingDebt ? 'Enter the amount they owe.' : 'Enter the amount.']
        : []
    }
    if (s === 'reason') return reasonStep?.required && !reasonStep.value.trim() ? ['Say what it’s for.'] : []
    if (s === 'charge') return charge.ok ? [] : ['Enter the charge in dollars, or 0.']
    if (s === 'plan')
      return [...new Set(validateTerms({ principalCents, chargeCents, instalments }, today).map(describeProblem))]
    return []
  }

  function goNext() {
    const problems = problemsFor(step)
    setErrors(problems)
    if (problems.length === 0) setStepIndex((i) => Math.min(i + 1, steps.length - 1))
  }

  function goBack() {
    setErrors([])
    if (stepIndex === 0) onBackFromStart?.()
    else setStepIndex((i) => i - 1)
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (step !== 'review') {
      goNext()
      return
    }
    const problems = steps.flatMap(problemsFor)
    setErrors(problems)
    if (problems.length > 0) return
    setSubmitting(true)
    try {
      await onSubmit({ principalCents, chargeCents, instalments, lateTerms, conditions, message })
    } catch (err) {
      setErrors([(err as Error).message])
      setSubmitting(false)
    }
  }

  function editRow(index: number, patch: Partial<Row>) {
    setManualRows(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  }

  const position = { step: stepIndex + 1, of: steps.length }
  const back = stepIndex > 0 || onBackFromStart ? goBack : undefined
  const continueButton = { label: 'Continue', submit: true }

  return (
    <form onSubmit={handleSubmit} noValidate>
      {step === 'amount' && (
        <WizardStep
          {...position}
          title={
            isExistingDebt
              ? 'How much do they owe you now?'
              : perspective === 'lender'
                ? 'How much will they owe you?'
                : 'How much do you need?'
          }
          hint={isExistingDebt ? 'Only what’s still owed today. Past payments don’t need entering.' : undefined}
          errors={errors}
          onBack={back}
          next={continueButton}
        >
          <MoneyField
            label={isExistingDebt ? 'Amount they owe you now' : 'Amount'}
            value={principalText}
            onChange={setPrincipalText}
            autoFocus
          />
        </WizardStep>
      )}

      {step === 'reason' && reasonStep && (
        <WizardStep
          {...position}
          title={reasonStep.title}
          hint={reasonStep.hint}
          errors={errors}
          onBack={back}
          next={continueButton}
        >
          <TextArea
            label="What it’s for"
            maxLength={500}
            rows={3}
            value={reasonStep.value}
            onChange={(e) => reasonStep.onChange(e.target.value)}
            placeholder="e.g. Car repairs, the WOF failed on the brakes"
            autoFocus
          />
        </WizardStep>
      )}

      {step === 'charge' && (
        <WizardStep
          {...position}
          title="Is there a charge?"
          hint="A one-off amount added on top, if you’ve agreed one. Most have none."
          errors={errors}
          onBack={back}
          next={continueButton}
        >
          <QuickPicks
            label="Quick charge"
            options={CHARGE_PRESETS.map((percent) => ({
              label: percent === 0 ? 'No charge' : `${percent}%`,
              value: toCents(Math.round((principalCents * percent) / 100)),
            }))}
            isActive={(cents) => charge.ok && chargeCents === cents}
            onPick={(cents) => setChargeText(centsToText(cents))}
          />
          <TextField
            label="One-off charge ($)"
            inputMode="decimal"
            value={chargeText}
            onChange={(e) => setChargeText(e.target.value)}
            hint={
              charge.ok && principalCents > 0
                ? `${chargePercent(principalCents, chargeCents)} of the amount`
                : undefined
            }
          />
          <TotalCard principalCents={principalCents} chargeCents={chargeCents} />
        </WizardStep>
      )}

      {step === 'plan' && (
        <WizardStep
          {...position}
          title="How will it be paid back?"
          hint={`${formatCents(totalCents)} in total.`}
          errors={errors}
          onBack={back}
          next={continueButton}
        >
          {manualRows === null ? (
            <>
              <CountStepper
                label="Payments"
                value={count}
                min={1}
                max={MAX_INSTALMENTS}
                onChange={setCount}
                unit={(n) => (n === 1 ? 'payment' : 'payments')}
              />
              {count > 1 && (
                <div>
                  <p className="mb-1.5 text-sm font-medium">How often</p>
                  <Segmented label="How often" options={FREQUENCIES} value={frequency} onChange={setFrequency} />
                </div>
              )}
              <TextField
                label={count > 1 ? 'First payment due' : 'Due'}
                type="date"
                min={today}
                value={firstDueOn}
                onChange={(e) => setFirstDueOn(e.target.value)}
              />
              <SchedulePreview rows={rows} />
              <button
                type="button"
                onClick={() => setManualRows(rows)}
                className="min-h-10 text-sm font-medium text-brand-ink hover:underline"
              >
                Change dates or amounts by hand
              </button>
            </>
          ) : (
            <ManualRows
              rows={rows}
              today={today}
              scheduleTotal={scheduleTotal}
              totalCents={totalCents}
              onEdit={editRow}
              onRemove={(index) => setManualRows(rows.filter((_, i) => i !== index))}
              onAdd={() =>
                setManualRows([
                  ...rows,
                  { dueOn: addDays((rows.at(-1)?.dueOn as IsoDate) || today, 7), amountText: '' },
                ])
              }
              onRebuild={() => setManualRows(null)}
            />
          )}
        </WizardStep>
      )}

      {step === 'review' && (
        <WizardStep
          {...position}
          title="Check and send"
          errors={errors}
          onBack={back}
          next={{ label: submitLabel, submit: true, busy: submitting }}
        >
          <TotalCard principalCents={principalCents} chargeCents={chargeCents} hideBreakdown={isExistingDebt} />
          {fixedCharge && chargeCents > 0 && (
            <p className="text-sm text-ink-muted">The charge is set by the person you’d owe.</p>
          )}
          <SchedulePreview rows={rows} />
          {reviewExtras}
          {messageLabel && (
            <TextArea
              label={messageLabel}
              maxLength={500}
              rows={2}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
          )}
        </WizardStep>
      )}
    </form>
  )
}

function TotalCard({
  principalCents,
  chargeCents,
  hideBreakdown = false,
}: {
  principalCents: Cents
  chargeCents: Cents
  hideBreakdown?: boolean
}) {
  return (
    <div className="rounded-3xl bg-brand px-5 py-4 text-on-brand">
      <p className="text-sm text-on-brand-muted">Total to pay back</p>
      <p className="font-display text-4xl leading-tight font-semibold tabular-nums">
        {formatCents(toCents(principalCents + chargeCents))}
      </p>
      {!hideBreakdown && (
        <p className="text-sm text-on-brand-muted tabular-nums">
          {formatCents(principalCents)} + {formatCents(chargeCents)} charge
        </p>
      )}
    </div>
  )
}

function amountOf(row: Row): Cents {
  const parsed = parseDollars(row.amountText)
  return parsed.ok ? parsed.cents : ZERO
}

/**
 * Changing existing terms starts in the simple "N payments, every week" mode
 * when the existing plan matches it, and in hand-edited mode otherwise.
 */
function startingPlan(initial: TermsInput | undefined): { manual: Row[] | null; frequency: Frequency } {
  const first = initial?.instalments[0]
  if (!initial || !first) return { manual: null, frequency: 'weekly' }
  for (const frequency of ['weekly', 'fortnightly', 'monthly'] as const) {
    const rebuilt = buildSchedule({
      totalCents: toCents(initial.principalCents + initial.chargeCents),
      count: initial.instalments.length,
      frequency,
      firstDueOn: first.dueOn,
    })
    const same = rebuilt.every(
      (r, i) => r.dueOn === initial.instalments[i]?.dueOn && r.amountCents === initial.instalments[i]?.amountCents,
    )
    if (same) return { manual: null, frequency }
  }
  return { manual: rowsFrom(initial.instalments), frequency: 'weekly' }
}

function SchedulePreview({ rows }: { rows: Row[] }) {
  if (rows.length === 0) return null
  return (
    <ol className="space-y-1.5 rounded-2xl border border-line p-4 text-sm tabular-nums" aria-label="Payment plan">
      {rows.map((row, index) => (
        <li key={index} className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className="flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-soft text-xs font-semibold text-on-brand-soft"
          >
            {index + 1}
          </span>
          <span className="flex-1">{isIsoDate(row.dueOn) ? formatDate(row.dueOn) : row.dueOn}</span>
          <span className="font-semibold">{formatCents(amountOf(row))}</span>
        </li>
      ))}
    </ol>
  )
}

function ManualRows({
  rows,
  today,
  scheduleTotal,
  totalCents,
  onEdit,
  onRemove,
  onAdd,
  onRebuild,
}: {
  rows: Row[]
  today: IsoDate
  scheduleTotal: Cents
  totalCents: Cents
  onEdit: (index: number, patch: Partial<Row>) => void
  onRemove: (index: number) => void
  onAdd: () => void
  onRebuild: () => void
}) {
  return (
    <div className="space-y-3">
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
              onChange={(e) => onEdit(index, { dueOn: e.target.value })}
              className="min-w-0 flex-1"
            />
            <TextField
              label="Amount ($)"
              inputMode="decimal"
              value={row.amountText}
              onChange={(e) => onEdit(index, { amountText: e.target.value })}
              className="w-24"
            />
            {rows.length > 1 && (
              <Button
                variant="ghost"
                className="px-2"
                aria-label={`Remove payment ${index + 1}`}
                onClick={() => onRemove(index)}
              >
                <CloseIcon className="size-4" />
              </Button>
            )}
          </li>
        ))}
      </ol>
      {rows.length < MAX_INSTALMENTS && (
        <Button variant="secondary" onClick={onAdd}>
          <PlusIcon className="size-4" />
          Add a payment
        </Button>
      )}
      <p className={`text-sm tabular-nums ${scheduleTotal === totalCents ? 'text-ink-muted' : 'text-danger'}`}>
        Payments add up to {formatCents(scheduleTotal)} of {formatCents(totalCents)}.
      </p>
      <Notice>
        Editing payments by hand.{' '}
        <button type="button" onClick={onRebuild} className="font-semibold underline">
          Split evenly again
        </button>
      </Notice>
    </div>
  )
}
