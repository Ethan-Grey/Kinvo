import { useState, type FormEvent, type ReactNode } from 'react'
import { todayInNZ } from '../../domain/dates'
import { formatCents } from '../../domain/money'
import type { PaymentMethod } from '../../data/database.types'
import { acceptTerms, confirmFundsSent, rejectTerms, withdrawLoan, type LoanDetail } from '../../data/loans'
import { ActionBar, ChoiceSheet, type Choice } from '../../shared/ActionBar'
import { CheckIcon, SendIcon } from '../../shared/icons'
import { Button, ButtonLink, Notice, Segmented, TextField } from '../../shared/ui'
import { ReceiptField } from '../repayments/ReceiptField'
import { PAYMENT_METHODS } from './labels'

type End = (action: () => Promise<void>) => () => Promise<void>

/**
 * The way out of a loan that hasn't started: the button's label, and the
 * sheet it opens asking whether to change things or end it.
 */
function wayOut(
  loan: LoanDetail,
  userId: string,
  end: End,
): { label: string; title: string; choices: Choice[] } | null {
  const otherFirst = (loan.role === 'lender' ? loan.borrowerName : loan.lenderName).split(' ')[0]
  const isDebt = loan.kind === 'existing_debt'
  const change: Choice = {
    label: 'Make changes',
    hint: `Send ${otherFirst} different terms`,
    to: `/loans/${loan.id}/change`,
  }
  const remove: Choice[] =
    loan.role === 'lender'
      ? [
          {
            label: 'Remove it completely',
            hint: 'For a test or a mistake',
            danger: true,
            to: `/loans/${loan.id}/remove`,
          },
        ]
      : []

  if (loan.status === 'negotiating' && loan.currentTerms.proposedBy !== userId) {
    return {
      label: 'Decline',
      title: 'Decline this?',
      choices: [
        ...(loan.kind === 'bill' ? [] : [change]),
        {
          label: isDebt ? 'It isn’t right, remove it' : 'Remove this request',
          hint: 'Nothing is recorded',
          danger: true,
          run: end(() => rejectTerms(loan.id, '')),
        },
        ...remove,
      ],
    }
  }
  if (loan.status === 'negotiating') {
    return {
      label: 'Change or cancel',
      title: 'Your request',
      choices: [
        change,
        {
          label: 'Cancel request',
          hint: 'Nothing is recorded',
          danger: true,
          run: end(() => withdrawLoan(loan.id, '')),
        },
        ...remove,
      ],
    }
  }
  if (loan.status === 'agreed') {
    return {
      label: 'Cancel',
      title: 'Cancel this?',
      choices: [
        {
          label: 'Cancel it',
          hint: 'Nothing has been paid out yet',
          danger: true,
          run: end(() => withdrawLoan(loan.id, '')),
        },
        ...remove,
      ],
    }
  }
  return null
}

/**
 * The bottom bar for a loan that hasn't started: the main action, and the
 * way out. Used on the loan page and on its accept and paid-out pages.
 */
export function LoanActionBar({
  loan,
  userId,
  primary,
  onEnded,
}: {
  loan: LoanDetail
  userId: string
  primary?: ReactNode
  onEnded: () => void
}) {
  const [sheet, setSheet] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const end: End = (action) => async () => {
    setError(null)
    try {
      await action()
      onEnded()
    } catch (err) {
      setError((err as Error).message)
    }
  }
  const out = wayOut(loan, userId, end)

  return (
    <>
      {error && <Notice tone="error">{error}</Notice>}
      <ActionBar>
        {out && (
          <Button variant="secondary" onClick={() => setSheet(true)} aria-haspopup="dialog">
            {out.label}
          </Button>
        )}
        {primary}
      </ActionBar>
      {out && <ChoiceSheet open={sheet} title={out.title} choices={out.choices} onClose={() => setSheet(false)} />}
    </>
  )
}

/** What the current user can do next on the loan page. Every rule is also enforced by the database. */
export function LoanActions({ loan, userId, onChanged }: { loan: LoanDetail; userId: string; onChanged: () => void }) {
  const otherFirst = (loan.role === 'lender' ? loan.borrowerName : loan.lenderName).split(' ')[0]
  const waitingOnThem = loan.status === 'negotiating' && loan.currentTerms.proposedBy !== userId

  let notice: string | null = null
  let primary: ReactNode = null
  if (waitingOnThem) {
    primary = (
      <ButtonLink to={`/loans/${loan.id}/accept`}>
        <CheckIcon className="size-5" />
        {loan.kind === 'existing_debt' ? 'Confirm' : 'Accept'}
      </ButtonLink>
    )
  } else if (loan.status === 'negotiating') {
    notice = `Waiting for ${otherFirst} to reply.`
  } else if (loan.status === 'agreed' && loan.role === 'lender') {
    notice = `${otherFirst} accepted. Pay them ${formatCents(loan.currentTerms.principalCents)}, then tap below.`
    primary = (
      <ButtonLink to={`/loans/${loan.id}/sent`}>
        <SendIcon className="size-5" />
        I’ve paid it out
      </ButtonLink>
    )
  } else if (loan.status === 'agreed') {
    notice = `Agreed. Waiting for ${otherFirst} to pay it out.`
  } else {
    return null
  }

  return (
    <>
      {notice && <Notice>{notice}</Notice>}
      <LoanActionBar loan={loan} userId={userId} primary={primary} onEnded={onChanged} />
    </>
  )
}

/** /loans/:id/accept — the one thing on the page is the promise you're making. */
export function AcceptForm({
  loan,
  userId,
  onAccepted,
  onEnded,
}: {
  loan: LoanDetail
  userId: string
  onAccepted: () => void
  onEnded: () => void
}) {
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
      <LoanActionBar
        loan={loan}
        userId={userId}
        onEnded={onEnded}
        primary={
          <Button disabled={!agreed} busy={busy} onClick={handleAccept}>
            {isDebt ? 'Confirm' : 'Accept'}
          </Button>
        }
      />
    </div>
  )
}

/** /loans/:id/sent — the lender confirms the money went out, which starts the loan. */
export function FundsSentForm({
  loan,
  userId,
  onSent,
  onEnded,
}: {
  loan: LoanDetail
  userId: string
  onSent: () => void
  onEnded: () => void
}) {
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
      <LoanActionBar
        loan={loan}
        userId={userId}
        onEnded={onEnded}
        primary={
          <Button type="submit" busy={busy}>
            Confirm
          </Button>
        }
      />
    </form>
  )
}
