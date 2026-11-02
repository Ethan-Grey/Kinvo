import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { todayInNZ, type IsoDate } from '../../domain/dates'
import { formatCents, parseDollars, type Cents } from '../../domain/money'
import type { PaymentMethod } from '../../data/database.types'
import { recordRepayment } from '../../data/repayments'
import { ChevronIcon } from '../../shared/icons'
import { Button, Notice, Segmented, TextField } from '../../shared/ui'
import { PAYMENT_METHODS } from '../loans/labels'

interface PaymentFormProps {
  loanId: string
  isLender: boolean
  lenderName: string
  outstandingCents: Cents
  /** Pre-fills the amount, e.g. what's left on the next instalment. */
  suggestedCents: Cents
  earliestDate: IsoDate
  /** Puts the cursor in the amount, e.g. when arriving from the + menu. */
  autoFocus?: boolean
  onRecorded: () => void
}

function toAmountText(cents: number): string {
  return (cents / 100).toFixed(2).replace(/\.00$/, '')
}

/**
 * Lender: "Record a payment" (counts straight away).
 * Borrower: "I've paid" (a claim the lender confirms).
 *
 * The amount is the big thing on the form, with one-tap choices for the usual
 * answers (the next payment, or everything that's left).
 */
export function PaymentForm({
  loanId,
  isLender,
  lenderName,
  outstandingCents,
  suggestedCents,
  earliestDate,
  autoFocus = false,
  onRecorded,
}: PaymentFormProps) {
  const today = todayInNZ()
  const amountId = useId()
  const amountRef = useRef<HTMLInputElement>(null)
  const [amountText, setAmountText] = useState(toAmountText(suggestedCents))
  const [receivedOn, setReceivedOn] = useState<string>(today)
  const [method, setMethod] = useState<PaymentMethod>('bank_transfer')
  const [showExtras, setShowExtras] = useState(false)
  const [reference, setReference] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  useEffect(() => {
    if (!autoFocus) return
    amountRef.current?.scrollIntoView({ block: 'center' })
    amountRef.current?.focus({ preventScroll: true })
  }, [autoFocus])

  const presets = [
    suggestedCents > 0 &&
      suggestedCents < outstandingCents && {
        label: `Next payment ${formatCents(suggestedCents)}`,
        cents: suggestedCents,
      },
    { label: `All of it ${formatCents(outstandingCents)}`, cents: outstandingCents },
  ].filter((p): p is { label: string; cents: Cents } => Boolean(p))

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setDone(false)

    const amount = parseDollars(amountText)
    if (!amount.ok || amount.cents === 0) {
      setError('Enter the amount paid.')
      return
    }
    if (amount.cents > outstandingCents) {
      setError(`That’s more than is owed. The most you can record is ${formatCents(outstandingCents)}.`)
      return
    }

    setBusy(true)
    try {
      await recordRepayment(loanId, { amountCents: amount.cents, receivedOn, method, reference, notes })
      setDone(true)
      setReference('')
      setNotes('')
      onRecorded()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      <div>
        <h2 className="text-lg font-semibold">{isLender ? 'Record a payment' : 'I’ve paid'}</h2>
        {!isLender && (
          <p className="text-sm text-ink-muted">
            Tell {lenderName} you’ve paid. It counts once they confirm they received it.
          </p>
        )}
      </div>

      <div>
        <label htmlFor={amountId} className="block text-sm font-medium">
          Amount
        </label>
        <div className="mt-1.5 flex items-center rounded-2xl border border-line px-4 focus-within:border-brand-ink focus-within:outline-2 focus-within:outline-brand/20">
          <span aria-hidden="true" className="font-display text-3xl font-semibold text-ink-muted">
            $
          </span>
          <input
            ref={amountRef}
            id={amountId}
            inputMode="decimal"
            autoComplete="off"
            required
            value={amountText}
            onChange={(e) => setAmountText(e.target.value)}
            aria-describedby={`${amountId}-hint`}
            className="min-h-16 w-full bg-transparent pl-1 font-display text-3xl font-semibold tabular-nums outline-none"
          />
        </div>
        <p id={`${amountId}-hint`} className="mt-1 text-xs text-ink-muted">
          Up to {formatCents(outstandingCents)}
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {presets.map((preset) => (
            <button
              key={preset.label}
              type="button"
              onClick={() => setAmountText(toAmountText(preset.cents))}
              className="min-h-9 rounded-full border border-line px-3 text-sm font-medium hover:border-brand-ink focus-visible:outline-2 focus-visible:outline-brand-ink"
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="mb-1.5 text-sm font-medium">How</p>
        <Segmented label="How it was paid" options={PAYMENT_METHODS} value={method} onChange={setMethod} />
      </div>

      <TextField
        label={isLender ? 'Date received' : 'Date paid'}
        type="date"
        min={earliestDate}
        max={today}
        required
        value={receivedOn}
        onChange={(e) => setReceivedOn(e.target.value)}
      />

      {showExtras ? (
        <div className="space-y-3">
          <TextField
            label="Reference (optional)"
            maxLength={100}
            value={reference}
            onChange={(e) => setReference(e.target.value)}
          />
          <TextField label="Note (optional)" maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setShowExtras(true)}
          className="inline-flex min-h-10 items-center gap-1 text-sm font-medium text-brand-ink hover:underline"
        >
          <ChevronIcon className="size-4" />
          Add a reference or note
        </button>
      )}

      {error && <Notice tone="error">{error}</Notice>}
      {done && <Notice tone="success">{isLender ? 'Payment recorded.' : `Sent to ${lenderName} to confirm.`}</Notice>}

      <Button type="submit" className="w-full" busy={busy}>
        {isLender ? 'Record payment' : 'Tell them I’ve paid'}
      </Button>
    </form>
  )
}
