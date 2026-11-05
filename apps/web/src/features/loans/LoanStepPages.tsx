import type { ReactNode } from 'react'
import { useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router'
import { formatCents, toCents } from '../../domain/money'
import { borrowerCharge, counterOffer, getLoan, removeLoan, type LoanDetail } from '../../data/loans'
import { getBalance, getInstalmentProgress } from '../../data/repayments'
import { useAsync } from '../../shared/useAsync'
import { Button, Notice, PageHeader, PageSkeleton, TextField } from '../../shared/ui'
import { useAuth } from '../auth/useAuth'
import { PaymentForm } from '../repayments/PaymentForm'
import { AcceptForm, FundsSentForm } from './LoanActions'
import { TermsForm } from './TermsForm'
import { TermsSummary } from './TermsSummary'

/**
 * Each action on a loan has its own page: accept, suggest changes, confirm
 * the money was sent, record a payment. The loan page itself just shows
 * where things stand and links here.
 */
export function LoanStep({
  title,
  children,
}: {
  title: (loan: LoanDetail) => string
  children: (loan: LoanDetail, done: (flash: string) => void) => ReactNode
}) {
  const { id = '' } = useParams()
  const { session } = useAuth()
  const userId = session?.user.id ?? ''
  const navigate = useNavigate()
  const [loan] = useAsync(() => getLoan(id, userId), `${id}:${userId}`)

  if (loan.status === 'loading') return <PageSkeleton label="Loading" />
  if (loan.status === 'error') return <Notice tone="error">{loan.error.message}</Notice>

  const done = (flash: string) => navigate(`/loans/${id}`, { replace: true, state: { flash } })

  return (
    <div className="space-y-6">
      <PageHeader back={{ to: `/loans/${id}`, label: 'Back' }} title={title(loan.data)} />
      {children(loan.data, done)}
    </div>
  )
}

const otherOf = (loan: LoanDetail) => (loan.role === 'lender' ? loan.borrowerName : loan.lenderName)

export function AcceptLoanPage() {
  return (
    <LoanStep
      title={(loan) =>
        loan.kind === 'existing_debt' ? 'Confirm what you owe' : loan.kind === 'bill' ? 'Accept your share' : 'Accept'
      }
    >
      {(loan, done) => (
        <>
          <LoanReason loan={loan} />
          <TermsSummary terms={loan.currentTerms} />
          <AcceptForm loan={loan} onAccepted={() => done(loan.kind === 'existing_debt' ? 'Confirmed.' : 'Accepted.')} />
        </>
      )}
    </LoanStep>
  )
}

export function ChangeTermsPage() {
  const { session } = useAuth()
  const userId = session?.user.id ?? ''
  return (
    <LoanStep title={(loan) => (loan.currentTerms.proposedBy === userId ? 'Change your proposal' : 'Suggest changes')}>
      {(loan, done) => (
        <TermsForm
          initial={{ ...loan.currentTerms, message: '' }}
          perspective={loan.role}
          fixedCharge={loan.role === 'borrower' ? (principal) => borrowerCharge(loan, principal) : undefined}
          variant={loan.kind === 'existing_debt' ? 'existing_debt' : 'new'}
          submitLabel={`Send to ${otherOf(loan)}`}
          messageLabel={`Message to ${otherOf(loan)} (optional)`}
          onSubmit={async (input) => {
            await counterOffer(loan.id, loan.currentTerms.id, input)
            done(`Sent to ${otherOf(loan)}.`)
          }}
        />
      )}
    </LoanStep>
  )
}

export function FundsSentPage() {
  return (
    <LoanStep
      title={(loan) => `Paid ${loan.borrowerName.split(' ')[0]} ${formatCents(loan.currentTerms.principalCents)}?`}
    >
      {(loan, done) => <FundsSentForm loan={loan} onSent={() => done('Done. Payments back are now tracked.')} />}
    </LoanStep>
  )
}

export function RecordPaymentPage() {
  return (
    <LoanStep title={(loan) => (loan.role === 'lender' ? 'Record a payment' : 'I’ve paid')}>
      {(loan, done) => <PaymentStep loan={loan} onDone={done} />}
    </LoanStep>
  )
}

function PaymentStep({ loan, onDone }: { loan: LoanDetail; onDone: (flash: string) => void }) {
  const [data] = useAsync(async () => {
    const [balance, progress] = await Promise.all([getBalance(loan.id), getInstalmentProgress(loan.id)])
    return { balance, progress }
  }, loan.id)

  if (data.status === 'loading') return <PageSkeleton label="Loading balance" />
  if (data.status === 'error') return <Notice tone="error">{data.error.message}</Notice>
  const { balance, progress } = data.data
  if (!balance || loan.status !== 'active' || balance.outstandingCents === 0) {
    return <Notice>There’s nothing left to pay.</Notice>
  }

  const nextUnpaid = progress.find((p) => p.status !== 'paid')
  const isLender = loan.role === 'lender'
  return (
    <PaymentForm
      loanId={loan.id}
      isLender={isLender}
      lenderName={loan.lenderName}
      outstandingCents={balance.outstandingCents}
      suggestedCents={toCents(Math.min(nextUnpaid?.remainingCents ?? 0, balance.outstandingCents))}
      earliestDate={loan.fundsSentOn ?? '2000-01-01'}
      onRecorded={() => onDone(isLender ? 'Payment recorded.' : `Sent to ${loan.lenderName} to confirm.`)}
    />
  )
}

/**
 * /loans/:id/remove — lender only. Hides a loan that shouldn't be there, such
 * as a test or a mistake, from every list and total (ADR-0015).
 */
export function RemoveLoanPage() {
  return (
    <LoanStep title={() => 'Remove this?'}>
      {(loan) =>
        loan.role === 'lender' ? (
          <RemoveForm loan={loan} />
        ) : (
          <Notice>Only the person who’s owed can remove this.</Notice>
        )
      }
    </LoanStep>
  )
}

function RemoveForm({ loan }: { loan: LoanDetail }) {
  const navigate = useNavigate()
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const funded = loan.status === 'active' || loan.status === 'completed' || loan.status === 'written_off'

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await removeLoan(loan.id, reason)
      navigate('/loans', { replace: true, state: { flash: 'Removed.' } })
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <p>
        Use this for a test or a mistake. The loan with {loan.borrowerName.split(' ')[0]} will disappear for both of
        you:
      </p>
      <ul className="list-inside list-disc space-y-1 text-sm text-ink-muted">
        <li>from your list, alerts and reminders</li>
        {funded && <li>from what’s owed, total paid out and charges received</li>}
        {funded && <li>from {loan.borrowerName.split(' ')[0]}’s track record</li>}
      </ul>
      <p className="text-sm text-ink-muted">
        Kinvo keeps a private note that it was removed, by whom and when. If this is real and has been settled or you’re
        letting go, use “Forgive the rest” instead.
      </p>
      <TextField
        label="Reason (optional)"
        maxLength={500}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="e.g. Just testing"
      />
      {error && <Notice tone="error">{error}</Notice>}
      <Button type="submit" variant="danger" className="w-full" busy={busy}>
        Remove
      </Button>
    </form>
  )
}

/** What the money is for, as the person asking put it. */
export function LoanReason({ loan }: { loan: LoanDetail }) {
  if (!loan.reason) return null
  const asker = loan.createdBy === loan.borrowerId ? loan.borrowerName.split(' ')[0] : loan.lenderName.split(' ')[0]
  return (
    <section className="rounded-3xl bg-brand-soft p-5 text-on-brand-soft" aria-label="What it’s for">
      <p className="text-sm font-semibold">What it’s for</p>
      <p className="mt-1 text-lg break-words">{loan.reason}</p>
      <p className="mt-1 text-xs">From {asker}</p>
    </section>
  )
}
