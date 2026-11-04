import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { todayInNZ } from '../../domain/dates'
import { formatCents } from '../../domain/money'
import type { PaymentMethod } from '../../data/database.types'
import { acceptTerms, confirmFundsSent, rejectTerms, withdrawLoan, type LoanDetail } from '../../data/loans'
import { CheckIcon, DocumentIcon, SendIcon } from '../../shared/icons'
import { Button, Notice, Segmented, TextField } from '../../shared/ui'
import { ReceiptField } from '../repayments/ReceiptField'
import { PAYMENT_METHODS } from './labels'

const primaryLink =
  'flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-brand px-5 font-semibold text-on-brand ' +
  'shadow-[0_6px_16px_-6px_rgb(111_26_7/0.6)] transition active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-ink'
const secondaryLink =
  'flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl border border-line px-5 font-semibold ' +
  'transition hover:border-brand-ink active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-ink'

/**
 * What the current user can do next on the loan page: at most one main
 * button, one alternative, and one quiet way out. Each main action opens its
 * own page. Every rule here is also enforced by the database.
 */
export function LoanActions({ loan, userId, onChanged }: { loan: LoanDetail; userId: string; onChanged: () => void }) {
  const proposedByMe = loan.currentTerms.proposedBy === userId
  const otherName = loan.role === 'lender' ? loan.borrowerName : loan.lenderName
  const isDebt = loan.kind === 'existing_debt'
  const isBill = loan.kind === 'bill'

  if (loan.status === 'negotiating' && !proposedByMe) {
    return (
      <div className="space-y-3">
        <Link to={`/loans/${loan.id}/accept`} className={primaryLink}>
          <CheckIcon className="size-5" />
          {isDebt ? 'Confirm this debt' : isBill ? 'Accept my share' : 'Accept'}
        </Link>
        <Link to={`/loans/${loan.id}/change`} className={secondaryLink}>
          <DocumentIcon className="size-5" />
          Suggest changes
        </Link>
        <QuietAction
          label={isDebt ? 'This isn’t right' : 'Decline'}
          question={
            isDebt
              ? `Tell ${otherName} this debt isn't right? It won't be recorded. You can talk it through and they can invite you again.`
              : isBill
                ? `Decline your share of ${loan.reason ?? 'this bill'}? It won't be recorded.`
                : `Decline ${otherName}'s proposal? This ends the request.`
          }
          action={() => rejectTerms(loan.id, '')}
          onDone={onChanged}
        />
      </div>
    )
  }

  if (loan.status === 'negotiating') {
    return (
      <div className="space-y-3">
        <Notice>
          Waiting for {otherName} to {isDebt ? 'confirm this debt' : isBill ? 'accept their share' : 'reply'}. You’ll
          get an alert when they do.
        </Notice>
        <Link to={`/loans/${loan.id}/change`} className={secondaryLink}>
          Change my proposal
        </Link>
        <QuietAction
          label="Withdraw"
          question="Withdraw your proposal? This ends the request."
          action={() => withdrawLoan(loan.id, '')}
          onDone={onChanged}
        />
      </div>
    )
  }

  if (loan.status === 'agreed' && loan.role === 'lender') {
    return (
      <div className="space-y-3">
        <p className="text-sm">
          {loan.borrowerName} accepted. Send them{' '}
          <span className="font-semibold">{formatCents(loan.currentTerms.principalCents)}</span> or pay for it, then
          tell Kinvo. Paying back starts once you do.
        </p>
        <Link to={`/loans/${loan.id}/sent`} className={primaryLink}>
          <SendIcon className="size-5" />
          I’ve paid it out
        </Link>
        <QuietAction
          label="Cancel"
          question="Cancel this? Nothing has been paid out yet."
          action={() => withdrawLoan(loan.id, '')}
          onDone={onChanged}
        />
      </div>
    )
  }

  if (loan.status === 'agreed') {
    return (
      <div className="space-y-3">
        <Notice>Agreed. Waiting for {loan.lenderName} to pay it out.</Notice>
        <QuietAction
          label="Cancel"
          question="Cancel this? Nothing has been paid out yet."
          action={() => withdrawLoan(loan.id, '')}
          onDone={onChanged}
        />
      </div>
    )
  }

  return null
}

/** A low-key text button for ending things, always behind a confirmation. */
function QuietAction({
  label,
  question,
  action,
  onDone,
}: {
  label: string
  question: string
  action: () => Promise<void>
  onDone: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleClick() {
    if (!window.confirm(question)) return
    setBusy(true)
    setError(null)
    try {
      await action()
      onDone()
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  return (
    <>
      {error && <Notice tone="error">{error}</Notice>}
      <Button variant="ghost" className="w-full text-danger" busy={busy} onClick={handleClick}>
        {label}
      </Button>
    </>
  )
}

/** /loans/:id/accept — the one thing on the page is the promise you're making. */
export function AcceptForm({ loan, onAccepted }: { loan: LoanDetail; onAccepted: () => void }) {
  const [agreed, setAgreed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const isBorrower = loan.role === 'borrower'
  const isDebt = loan.kind === 'existing_debt'
  const total = formatCents(loan.currentTerms.totalCents)

  const statement =
    loan.kind === 'bill'
      ? isBorrower
        ? `I agree I owe ${loan.lenderName} ${total} as my share of ${loan.reason ?? 'the bill'}, to be paid back on the date shown.`
        : `I confirm ${loan.borrowerName} owes me ${total} as their share of ${loan.reason ?? 'the bill'}.`
      : isDebt
        ? isBorrower
          ? `I confirm I owe ${loan.lenderName} ${total}, and I agree to pay it back on the dates shown.`
          : `I confirm ${loan.borrowerName} owes me ${total}, to be paid back on the dates shown.`
        : isBorrower
          ? `I agree to pay ${loan.lenderName} back ${total} on the dates shown, under these terms.`
          : `I agree to pay out ${formatCents(loan.currentTerms.principalCents)} for ${loan.borrowerName}, to be paid back under these terms.`

  async function handleAccept() {
    setBusy(true)
    setError(null)
    try {
      await acceptTerms(loan.id, loan.currentTerms)
      onAccepted()
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <label
        className={`flex cursor-pointer gap-3 rounded-2xl border-2 p-4 transition-colors ${agreed ? 'border-brand' : 'border-line'}`}
      >
        <input
          type="checkbox"
          checked={agreed}
          onChange={(e) => setAgreed(e.target.checked)}
          className="mt-0.5 size-5 shrink-0 accent-brand"
        />
        <span>{statement}</span>
      </label>
      {error && <Notice tone="error">{error}</Notice>}
      <Button className="w-full" disabled={!agreed} busy={busy} onClick={handleAccept}>
        {isDebt ? 'Confirm what you owe' : loan.kind === 'bill' ? 'Accept my share' : 'Accept agreement'}
      </Button>
      <p className="text-xs text-ink-muted">
        Accepting records your agreement, the date and time, and a fingerprint of these exact terms. It’s a record of
        what you both agreed, not a guarantee that it’s legally enforceable.
      </p>
    </div>
  )
}

/** /loans/:id/sent — the lender confirms the money went out, which starts the loan. */
export function FundsSentForm({ loan, onSent }: { loan: LoanDetail; onSent: () => void }) {
  const today = todayInNZ()
  const [sentOn, setSentOn] = useState(today)
  const [method, setMethod] = useState<PaymentMethod>('bank_transfer')
  const [reference, setReference] = useState('')
  const [receiptPath, setReceiptPath] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!receiptPath) {
      setError('Add a photo of the bank transfer or receipt.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await confirmFundsSent(loan.id, sentOn, method, reference, receiptPath)
      onSent()
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <p className="mb-1.5 text-sm font-medium">How did you pay it?</p>
        <Segmented label="How did you pay it?" options={PAYMENT_METHODS} value={method} onChange={setMethod} />
      </div>
      <TextField
        label="Date paid"
        type="date"
        max={today}
        required
        value={sentOn}
        onChange={(e) => setSentOn(e.target.value)}
      />
      <TextField
        label="Reference (optional)"
        maxLength={100}
        value={reference}
        onChange={(e) => setReference(e.target.value)}
        placeholder="e.g. bank transfer reference"
      />
      <div>
        <p className="mb-1.5 text-sm font-medium">Receipt</p>
        <ReceiptField loanId={loan.id} onChange={setReceiptPath} />
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      <Button type="submit" className="w-full" busy={busy}>
        Confirm money sent
      </Button>
    </form>
  )
}
