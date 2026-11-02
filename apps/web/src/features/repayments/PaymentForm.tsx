import { useState, type FormEvent } from 'react'
import { formatDate, isIsoDate, todayInNZ, type IsoDate } from '../../domain/dates'
import { formatCents, parseDollars, type Cents } from '../../domain/money'
import type { PaymentMethod } from '../../data/database.types'
import { recordRepayment } from '../../data/repayments'
import { MoneyField, QuickPicks, WizardStep } from '../../shared/Wizard'
import { Segmented, TextField } from '../../shared/ui'
import { PAYMENT_METHODS, methodLabel } from '../loans/labels'
import { ReceiptField } from './ReceiptField'

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

function toAmountText(cents: number): string {
  return cents === 0 ? '' : (cents / 100).toFixed(2).replace(/\.00$/, '')
}

/**
 * Lender: "Record a payment" (counts straight away).
 * Borrower: "I've paid" (a claim the lender confirms).
 *
 * Three short steps: how much, how and when, then the receipt.
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
  const [step, setStep] = useState<'amount' | 'details' | 'receipt'>('amount')
  const [receiptPath, setReceiptPath] = useState<string | null>(null)
  const [amountText, setAmountText] = useState(toAmountText(suggestedCents))
  const [receivedOn, setReceivedOn] = useState<string>(today)
  const [method, setMethod] = useState<PaymentMethod>('bank_transfer')
  const [reference, setReference] = useState('')
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<string[]>([])

  const amount = parseDollars(amountText)

  function amountProblems(): string[] {
    if (!amount.ok || amount.cents === 0) return ['Enter the amount paid.']
    if (amount.cents > outstandingCents) {
      return [`That’s more than is owed. The most you can record is ${formatCents(outstandingCents)}.`]
    }
    return []
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const problems = amountProblems()
    setErrors(problems)
    if (problems.length > 0 || !amount.ok) return
    if (step !== 'receipt') {
      setStep(step === 'amount' ? 'details' : 'receipt')
      return
    }
    if (!receiptPath) {
      setErrors(['Add a photo of the receipt or bank statement.'])
      return
    }
    setBusy(true)
    try {
      await recordRepayment(loanId, {
        amountCents: amount.cents,
        receivedOn,
        method,
        reference,
        notes: '',
        receiptPath,
      })
      onRecorded()
    } catch (err) {
      setErrors([(err as Error).message])
      setBusy(false)
    }
  }

  const presets = [
    suggestedCents > 0 && suggestedCents < outstandingCents
      ? { label: `Next payment ${formatCents(suggestedCents)}`, value: suggestedCents }
      : null,
    { label: `All of it ${formatCents(outstandingCents)}`, value: outstandingCents },
  ].filter((p): p is { label: string; value: Cents } => p !== null)

  return (
    <form onSubmit={handleSubmit} noValidate>
      {step === 'amount' ? (
        <WizardStep
          step={1}
          of={3}
          title={isLender ? 'How much did they pay?' : 'How much did you pay?'}
          hint={isLender ? undefined : `${lenderName} confirms it once it arrives.`}
          errors={errors}
          next={{ label: 'Continue', submit: true }}
        >
          <MoneyField
            label="Amount"
            value={amountText}
            onChange={setAmountText}
            hint={`Up to ${formatCents(outstandingCents)}`}
            autoFocus
          />
          <QuickPicks
            label="Quick amounts"
            options={presets}
            isActive={(cents) => amount.ok && amount.cents === cents}
            onPick={(cents) => setAmountText(toAmountText(cents))}
          />
        </WizardStep>
      ) : step === 'details' ? (
        <WizardStep
          step={2}
          of={3}
          title={`${amount.ok ? formatCents(amount.cents) : ''} by ${methodLabel(method).toLowerCase()}`}
          hint={`On ${isIsoDate(receivedOn) ? formatDate(receivedOn) : receivedOn}`}
          errors={errors}
          onBack={() => {
            setErrors([])
            setStep('amount')
          }}
          next={{ label: 'Continue', submit: true }}
        >
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
          <TextField
            label="Reference (optional)"
            maxLength={100}
            value={reference}
            onChange={(e) => setReference(e.target.value)}
          />
        </WizardStep>
      ) : (
        <WizardStep
          step={3}
          of={3}
          title="Add the receipt"
          hint={
            isLender ? 'Proof the money arrived, for both of your records.' : `So ${lenderName} can check it arrived.`
          }
          errors={errors}
          onBack={() => {
            setErrors([])
            setStep('details')
          }}
          next={{ label: isLender ? 'Record payment' : 'Tell them I’ve paid', submit: true, busy }}
        >
          <ReceiptField
            loanId={loanId}
            onChange={(path) => {
              setReceiptPath(path)
              if (path) setErrors([])
            }}
          />
        </WizardStep>
      )}
    </form>
  )
}
