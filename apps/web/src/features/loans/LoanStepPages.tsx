import type { ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router'
import { formatCents, toCents } from '../../domain/money'
import { counterOffer, getLoan, type LoanDetail } from '../../data/loans'
import { getBalance, getInstalmentProgress } from '../../data/repayments'
import { useAsync } from '../../shared/useAsync'
import { Card, Notice, PageHeader, PageSkeleton } from '../../shared/ui'
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
function LoanStep({
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

  if (loan.status === 'loading') return <PageSkeleton label="Loading loan" />
  if (loan.status === 'error') return <Notice tone="error">{loan.error.message}</Notice>

  const done = (flash: string) => navigate(`/loans/${id}`, { replace: true, state: { flash } })

  return (
    <div className="space-y-6">
      <PageHeader back={{ to: `/loans/${id}`, label: 'Loan' }} title={title(loan.data)} />
      {children(loan.data, done)}
    </div>
  )
}

const otherOf = (loan: LoanDetail) => (loan.role === 'lender' ? loan.borrowerName : loan.lenderName)

export function AcceptLoanPage() {
  return (
    <LoanStep title={(loan) => (loan.kind === 'existing_debt' ? 'Confirm this debt' : 'Accept the loan')}>
      {(loan, done) => (
        <>
          <Card>
            <TermsSummary terms={loan.currentTerms} lenderName={loan.lenderName} borrowerName={loan.borrowerName} />
          </Card>
          <AcceptForm
            loan={loan}
            onAccepted={() => done(loan.kind === 'existing_debt' ? 'Debt confirmed.' : 'Loan accepted.')}
          />
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
          variant={loan.kind}
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
      title={(loan) => `Sent ${formatCents(loan.currentTerms.principalCents)} to ${loan.borrowerName.split(' ')[0]}?`}
    >
      {(loan, done) => <FundsSentForm loan={loan} onSent={() => done('Loan started.')} />}
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
    return <Notice>There’s nothing left to pay on this loan.</Notice>
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
