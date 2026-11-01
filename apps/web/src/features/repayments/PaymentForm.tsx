import { useState, type FormEvent } from 'react'
import { todayInNZ, type IsoDate } from '../../domain/dates'
import { formatCents, parseDollars, type Cents } from '../../domain/money'
import type { PaymentMethod } from '../../data/database.types'
import { recordRepayment } from '../../data/repayments'
import { Button, Notice, Select, TextField } from '../../shared/ui'
import { PAYMENT_METHODS } from '../loans/labels'

interface PaymentFormProps {
  loanId: string
  isLender: boolean
  lenderName: string
  outstandingCents: Cents
  /** Pre-fills the amount, e.g. what's left on the next instalment. */
  suggestedCents: Cents
  earliestDate: IsoDate
  onRecorded: () => void
}

/**
 * Lender: "Record a payment" (counts straight away).
 * Borrower: "I've paid" (a claim the lender confirms).
 */
export function PaymentForm({
  loanId,
  isLender,
  lenderName,
  outstandingCents,
  suggestedCents,
  earliestDate,
  onRecorded,
}: PaymentFormProps) {
  const today = todayInNZ()
  const [amountText, setAmountText] = useState((suggestedCents / 100).toFixed(2).replace(/\.00$/, ''))
  const [receivedOn, setReceivedOn] = useState<string>(today)
  const [method, setMethod] = useState<PaymentMethod>('bank_transfer')
  const [reference, setReference] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

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
    <form onSubmit={handleSubmit} className="space-y-3" noValidate>
      <h3 className="font-semibold">{isLender ? 'Record a payment' : 'I’ve paid'}</h3>
      {!isLender && (
        <p className="text-sm text-ink-muted">
          Tell {lenderName} you’ve paid. It counts once they confirm they received it.
        </p>
      )}
      <div className="grid grid-cols-2 gap-2">
        <TextField
          label="Amount ($)"
          inputMode="decimal"
          required
          value={amountText}
          onChange={(e) => setAmountText(e.target.value)}
          hint={`Up to ${formatCents(outstandingCents)}`}
        />
        <TextField
          label={isLender ? 'Date received' : 'Date paid'}
          type="date"
          min={earliestDate}
          max={today}
          required
          value={receivedOn}
          onChange={(e) => setReceivedOn(e.target.value)}
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Select
          label="How"
          options={PAYMENT_METHODS}
          value={method}
          onChange={(e) => setMethod(e.target.value as PaymentMethod)}
        />
        <TextField
          label="Reference (optional)"
          maxLength={100}
          value={reference}
          onChange={(e) => setReference(e.target.value)}
        />
      </div>
      <TextField label="Notes (optional)" maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} />

      {error && <Notice tone="error">{error}</Notice>}
      {done && (
        <Notice tone="success">{isLender ? 'Payment recorded.' : `Sent to ${lenderName} to confirm.`}</Notice>
      )}

      <Button type="submit" className="w-full" busy={busy}>
        {isLender ? 'Record payment' : 'Tell them I’ve paid'}
      </Button>
    </form>
  )
}
