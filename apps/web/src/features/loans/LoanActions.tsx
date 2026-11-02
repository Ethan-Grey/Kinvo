import { useState, type FormEvent } from 'react'
import { todayInNZ } from '../../domain/dates'
import { formatCents } from '../../domain/money'
import type { PaymentMethod } from '../../data/database.types'
import { acceptTerms, confirmFundsSent, rejectTerms, withdrawLoan, type LoanDetail } from '../../data/loans'
import { Button, Notice, Select, TextField } from '../../shared/ui'
import { PAYMENT_METHODS } from './labels'

interface ActionProps {
  loan: LoanDetail
  userId: string
  onChanged: () => void
  onCounter: () => void
}

/**
 * The buttons for whatever the current user can do next. Every rule shown
 * here is also enforced by the database; this only decides what to offer.
 */
export function LoanActions({ loan, userId, onChanged, onCounter }: ActionProps) {
  const proposedByMe = loan.currentTerms.proposedBy === userId
  const otherName = loan.role === 'lender' ? loan.borrowerName : loan.lenderName

  if (loan.status === 'negotiating') {
    return proposedByMe ? (
      <WaitingForReply
        otherName={otherName}
        loanId={loan.id}
        isDebt={loan.kind === 'existing_debt'}
        onChanged={onChanged}
        onCounter={onCounter}
      />
    ) : (
      <ReplyToProposal loan={loan} otherName={otherName} onChanged={onChanged} onCounter={onCounter} />
    )
  }

  if (loan.status === 'agreed') {
    return loan.role === 'lender' ? (
      <ConfirmFunds loan={loan} onChanged={onChanged} />
    ) : (
      <div className="space-y-3">
        <Notice>Agreed. Waiting for {loan.lenderName} to send the money.</Notice>
        <CancelAgreed loanId={loan.id} onChanged={onChanged} />
      </div>
    )
  }

  return null
}

function ReplyToProposal({
  loan,
  otherName,
  onChanged,
  onCounter,
}: {
  loan: LoanDetail
  otherName: string
  onChanged: () => void
  onCounter: () => void
}) {
  const [agreed, setAgreed] = useState(false)
  const [busy, setBusy] = useState<'accept' | 'reject' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const isBorrower = loan.role === 'borrower'
  const isDebt = loan.kind === 'existing_debt'
  const total = formatCents(loan.currentTerms.totalCents)

  const statement = isDebt
    ? isBorrower
      ? `I confirm I owe ${loan.lenderName} ${total}, and I agree to repay it on the dates above.`
      : `I confirm ${loan.borrowerName} owes me ${total}, to be repaid on the dates above.`
    : isBorrower
      ? `I agree to repay ${loan.lenderName} ${total} on the dates above, under these terms.`
      : `I agree to lend ${loan.borrowerName} ${formatCents(loan.currentTerms.principalCents)} under these terms.`

  async function run(kind: 'accept' | 'reject', action: () => Promise<void>) {
    setBusy(kind)
    setError(null)
    try {
      await action()
      onChanged()
    } catch (err) {
      setError((err as Error).message)
      setBusy(null)
    }
  }

  return (
    <div className="space-y-4">
      <label
        className={`flex cursor-pointer gap-3 rounded-2xl border-2 p-4 text-sm transition-colors ${agreed ? 'border-brand' : 'border-line'}`}
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

      <Button
        className="w-full"
        disabled={!agreed || busy !== null}
        busy={busy === 'accept'}
        onClick={() => run('accept', () => acceptTerms(loan.id, loan.currentTerms))}
      >
        {isDebt ? 'Confirm this debt' : 'Accept Loan Agreement'}
      </Button>
      <div className="grid grid-cols-2 gap-2">
        <Button variant="secondary" className="px-3" onClick={onCounter} disabled={busy !== null}>
          Suggest changes
        </Button>
        <Button
          variant="danger"
          className="px-3"
          busy={busy === 'reject'}
          disabled={busy !== null}
          onClick={() => {
            const question = isDebt
              ? `Tell ${otherName} this debt isn't right? It won't be recorded. You can talk it through and they can invite you again.`
              : `Decline ${otherName}'s proposal? This ends the request.`
            if (window.confirm(question)) {
              void run('reject', () => rejectTerms(loan.id, ''))
            }
          }}
        >
          {isDebt ? 'This isn’t right' : 'Decline'}
        </Button>
      </div>
      <p className="text-xs text-ink-muted">
        Accepting records your agreement, the date and time, and a fingerprint of these exact terms. It’s a record of
        what you both agreed, not a guarantee that it’s legally enforceable.
      </p>
    </div>
  )
}

function WaitingForReply({
  otherName,
  loanId,
  isDebt,
  onChanged,
  onCounter,
}: {
  otherName: string
  loanId: string
  isDebt: boolean
  onChanged: () => void
  onCounter: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleWithdraw() {
    if (!window.confirm('Withdraw your proposal? This ends the request.')) return
    setBusy(true)
    try {
      await withdrawLoan(loanId, '')
      onChanged()
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      <Notice>
        Waiting for {otherName} to {isDebt ? 'confirm this debt' : 'reply'}.
      </Notice>
      {error && <Notice tone="error">{error}</Notice>}
      <div className="grid grid-cols-2 gap-2">
        <Button variant="secondary" onClick={onCounter} disabled={busy}>
          Change my proposal
        </Button>
        <Button variant="danger" onClick={handleWithdraw} busy={busy}>
          Withdraw
        </Button>
      </div>
    </div>
  )
}

function ConfirmFunds({ loan, onChanged }: { loan: LoanDetail; onChanged: () => void }) {
  const today = todayInNZ()
  const [sentOn, setSentOn] = useState(today)
  const [method, setMethod] = useState<PaymentMethod>('bank_transfer')
  const [reference, setReference] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await confirmFundsSent(loan.id, sentOn, method, reference)
      onChanged()
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <Notice>
        {loan.borrowerName} accepted. Send them {formatCents(loan.currentTerms.principalCents)}, then confirm it here.
        The loan starts once you confirm.
      </Notice>
      <div className="grid grid-cols-2 gap-2">
        <TextField
          label="Date sent"
          type="date"
          max={today}
          required
          value={sentOn}
          onChange={(e) => setSentOn(e.target.value)}
        />
        <Select
          label="How"
          options={PAYMENT_METHODS}
          value={method}
          onChange={(e) => setMethod(e.target.value as PaymentMethod)}
        />
      </div>
      <TextField
        label="Reference (optional)"
        maxLength={100}
        value={reference}
        onChange={(e) => setReference(e.target.value)}
        placeholder="e.g. bank transfer reference"
      />
      {error && <Notice tone="error">{error}</Notice>}
      <Button type="submit" className="w-full" busy={busy}>
        Confirm money sent
      </Button>
      <CancelAgreed loanId={loan.id} onChanged={onChanged} />
    </form>
  )
}

function CancelAgreed({ loanId, onChanged }: { loanId: string; onChanged: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleCancel() {
    if (!window.confirm('Cancel this loan? No money has been sent yet.')) return
    setBusy(true)
    try {
      await withdrawLoan(loanId, '')
      onChanged()
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  return (
    <>
      {error && <Notice tone="error">{error}</Notice>}
      <Button variant="ghost" className="w-full" onClick={handleCancel} busy={busy}>
        Cancel loan
      </Button>
    </>
  )
}
