import { useState, type FormEvent } from 'react'
import { todayInNZ } from '../../domain/dates'
import { formatCents } from '../../domain/money'
import type { PaymentMethod } from '../../data/database.types'
import { acceptTerms, confirmFundsSent, rejectTerms, withdrawLoan, type LoanDetail } from '../../data/loans'
import { CheckIcon, DocumentIcon, SendIcon } from '../../shared/icons'
import { Button, ButtonLink, Notice, Segmented, TextField } from '../../shared/ui'
import { ReceiptField } from '../repayments/ReceiptField'
import { PAYMENT_METHODS } from './labels'

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
        <ButtonLink to={`/loans/${loan.id}/accept`}>
          <CheckIcon className="size-5" />
          {isDebt ? 'Confirm this debt' : isBill ? 'Accept my share' : 'Accept'}
        </ButtonLink>
        <ButtonLink to={`/loans/${loan.id}/change`} variant="secondary">
          <DocumentIcon className="size-5" />
          Suggest changes
        </ButtonLink>
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
        <Notice>Waiting for {otherName.split(' ')[0]} to reply.</Notice>
        <ButtonLink to={`/loans/${loan.id}/change`} variant="secondary">
          Change my proposal
        </ButtonLink>
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
        <Notice>
          {loan.borrowerName.split(' ')[0]} accepted. Pay them{' '}
          <span className="font-semibold">{formatCents(loan.currentTerms.principalCents)}</span>, then tap below.
        </Notice>
        <ButtonLink to={`/loans/${loan.id}/sent`}>
          <SendIcon className="size-5" />
          I’ve paid it out
        </ButtonLink>
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
    loan.kind === 'bill' || isDebt
      ? isBorrower
        ? `I owe ${loan.lenderName.split(' ')[0]} ${total} and will pay it on these dates.`
        : `${loan.borrowerName.split(' ')[0]} owes me ${total}.`
      : isBorrower
        ? `I’ll pay ${loan.lenderName.split(' ')[0]} back ${total} on these dates.`
        : `I’ll pay ${loan.borrowerName.split(' ')[0]} ${formatCents(loan.currentTerms.principalCents)}.`

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
        {isDebt ? 'Confirm' : loan.kind === 'bill' ? 'Accept my share' : 'Accept'}
      </Button>
    </div>
  )
}

/** /loans/:id/sent — the lender confirms the money went out, which starts the loan. */
export function FundsSentForm({ loan, onSent }: { loan: LoanDetail; onSent: () => void }) {
  const today = todayInNZ()
  const [sentOn, setSentOn] = useState(today)
  const [method, setMethod] = useState<PaymentMethod>('bank_transfer')
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
      await confirmFundsSent(loan.id, sentOn, method, '', receiptPath)
      onSent()
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <p className="mb-1.5 text-sm font-medium">How</p>
        <Segmented label="How" options={PAYMENT_METHODS} value={method} onChange={setMethod} />
      </div>
      <TextField
        label="When"
        type="date"
        max={today}
        required
        value={sentOn}
        onChange={(e) => setSentOn(e.target.value)}
      />
      <div>
        <p className="mb-1.5 text-sm font-medium">Proof of payment</p>
        <ReceiptField loanId={loan.id} onChange={setReceiptPath} />
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      <Button type="submit" className="w-full" busy={busy}>
        Confirm
      </Button>
    </form>
  )
}
