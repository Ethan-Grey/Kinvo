import { useState, type FormEvent } from 'react'
import { todayInNZ } from '../../domain/dates'
import { formatCents, parseDollars, type Cents } from '../../domain/money'
import { recordRepayment } from '../../data/repayments'
import { MoneyField, QuickPicks, WizardStep } from '../../shared/Wizard'
import { ReceiptField } from './ReceiptField'

interface PaymentFormProps {
  loanId: string
  isLender: boolean
  lenderName: string
  outstandingCents: Cents
  /** Pre-fills the amount, e.g. what's left on the next instalment. */
  suggestedCents: Cents
  onRecorded: () => void
}

function toAmountText(cents: number): string {
  return cents === 0 ? '' : (cents / 100).toFixed(2).replace(/\.00$/, '')
}

/**
 * Lender: "Record payment" (counts straight away).
 * Borrower: "I've paid" (a claim the lender confirms).
 *
 * One screen: the amount (pre-filled) and the receipt. It's dated today and
 * recorded as a bank transfer, which covers almost every payment.
 */
export function PaymentForm({
  loanId,
  isLender,
  lenderName,
  outstandingCents,
  suggestedCents,
  onRecorded,
}: PaymentFormProps) {
  const [receiptPath, setReceiptPath] = useState<string | null>(null)
  const [amountText, setAmountText] = useState(toAmountText(suggestedCents))
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<string[]>([])

  const amount = parseDollars(amountText)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!amount.ok || amount.cents === 0) return setErrors(['Enter the amount paid.'])
    if (amount.cents > outstandingCents) {
      return setErrors([`That’s more than is owed. The most you can record is ${formatCents(outstandingCents)}.`])
    }
    if (!receiptPath) return setErrors(['Add a photo of the receipt or bank statement.'])
    setErrors([])
    setBusy(true)
    try {
      await recordRepayment(loanId, {
        amountCents: amount.cents,
        receivedOn: todayInNZ(),
        method: 'bank_transfer',
        reference: '',
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
      <WizardStep
        step={1}
        of={1}
        title={isLender ? 'How much did they pay?' : 'How much did you pay?'}
        hint={isLender ? undefined : `${lenderName} confirms it once it arrives.`}
        errors={errors}
        next={{ label: isLender ? 'Record payment' : 'I’ve paid', submit: true, busy }}
      >
        <MoneyField
          label="Amount"
          value={amountText}
          onChange={setAmountText}
          hint={`Up to ${formatCents(outstandingCents)}`}
        />
        <QuickPicks
          label="Quick amounts"
          options={presets}
          isActive={(cents) => amount.ok && amount.cents === cents}
          onPick={(cents) => setAmountText(toAmountText(cents))}
        />
        <div>
          <p className="mb-1.5 text-sm font-medium">Receipt</p>
          <ReceiptField
            loanId={loanId}
            onChange={(path) => {
              setReceiptPath(path)
              if (path) setErrors([])
            }}
          />
        </div>
      </WizardStep>
    </form>
  )
}
