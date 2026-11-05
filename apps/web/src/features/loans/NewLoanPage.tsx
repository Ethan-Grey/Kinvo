import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { Avatar } from '../../shared/Avatar'
import { ChevronIcon, PeopleIcon } from '../../shared/icons'
import { createLoan } from '../../data/loans'
import { toCents } from '../../domain/money'
import { listPeople, type Connection } from '../../data/people'
import { useAsync } from '../../shared/useAsync'
import { Card, EmptyState, Notice, PageHeader, PageSkeleton, TextArea, TextField } from '../../shared/ui'
import { WizardStep } from '../../shared/Wizard'
import { useAuth } from '../auth/useAuth'
import { TermsForm } from './TermsForm'

interface Counterparty extends Connection {
  myRole: 'lender' | 'borrower'
}

/**
 * /loans/new?with=<relationship id> — a borrower's request or a lender's offer.
 * Both use the same form; the wording follows the user's role.
 */
export function NewLoanPage() {
  const { session } = useAuth()
  const userId = session?.user.id ?? ''
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [people] = useAsync(() => listPeople(userId), userId)
  const [chosen, setChosen] = useState<string | null>(params.get('with'))
  const [reason, setReason] = useState('')
  // Asking to borrow starts with what it's for (required); offers ask at the end (optional).
  const [reasonDone, setReasonDone] = useState(false)
  const [reasonError, setReasonError] = useState<string[]>([])

  if (people.status === 'loading') return <PageSkeleton label="Loading" />
  if (people.status === 'error') return <Notice tone="error">{people.error.message}</Notice>

  const counterparties: Counterparty[] = [
    ...people.data.lenders.map((p) => ({ ...p, myRole: 'borrower' as const })),
    ...people.data.borrowers.map((p) => ({ ...p, myRole: 'lender' as const })),
  ]

  if (counterparties.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={<PeopleIcon className="size-6" />}
          title="No one connected yet"
          action={
            <Link to="/loans" className="text-sm font-medium text-brand-ink underline">
              Back
            </Link>
          }
        >
          You need to be connected through an invite link first.
        </EmptyState>
      </Card>
    )
  }

  // "Ask to borrow" from the + menu only offers lenders, "Offer a loan" only borrowers.
  const preferredRole = params.get('as')
  const candidates = counterparties.filter((p) => !preferredRole || p.myRole === preferredRole)
  const pool = candidates.length > 0 ? candidates : counterparties
  const selected = pool.find((p) => p.relationshipId === chosen) ?? (pool.length === 1 ? pool[0] : undefined)

  if (!selected) {
    return (
      <div className="space-y-6">
        <PageHeader back={{ to: '/loans', label: 'Owed' }} title="Who with?" />
        <ul className="space-y-2">
          {pool.map((p) => (
            <li key={p.relationshipId}>
              <button
                type="button"
                onClick={() => setChosen(p.relationshipId)}
                className="flex w-full items-center gap-3 rounded-3xl border border-line p-3 pr-4 text-left transition hover:border-brand-ink active:scale-[0.99] focus-visible:outline-2 focus-visible:outline-brand-ink"
              >
                <Avatar name={p.personName} photo={p.personPhoto} size="lg" />
                <span className="min-w-0 flex-1">
                  <span className="block font-display text-lg font-semibold">{p.personName}</span>
                  <span className="block text-sm text-ink-muted">
                    {p.myRole === 'borrower' ? 'Add what you owe them' : 'Add what they owe you'}
                  </span>
                </span>
                <ChevronIcon className="size-5 text-ink-muted" />
              </button>
            </li>
          ))}
        </ul>
      </div>
    )
  }

  const isRequest = selected.myRole === 'borrower'
  const canChangePerson = pool.length > 1 && !params.get('with')
  const first = selected.personName.split(' ')[0]

  if (isRequest && !reasonDone) {
    return (
      <div className="space-y-6">
        <PageHeader back={{ to: '/loans', label: 'Owed' }} title={`What you owe ${first}`} />
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault()
            if (!reason.trim()) return setReasonError([`Tell ${first} what it’s for.`])
            setReasonError([])
            setReasonDone(true)
          }}
        >
          <WizardStep
            step={1}
            of={1}
            title="What do you need it for?"
            hint={`${first} sees this when they look at your request.`}
            errors={reasonError}
            onBack={canChangePerson ? () => setChosen(null) : undefined}
            next={{ label: 'Continue', submit: true }}
          >
            <TextArea
              label="What it’s for"
              maxLength={500}
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Car repairs, the WOF failed on the brakes"
              autoFocus
            />
          </WizardStep>
        </form>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        back={{ to: '/loans', label: 'Owed' }}
        title={
          isRequest
            ? `What you owe ${selected.personName.split(' ')[0]}`
            : `What ${selected.personName.split(' ')[0]} owes you`
        }
      />
      <TermsForm
        key={selected.relationshipId}
        perspective={selected.myRole}
        fixedCharge={isRequest ? () => toCents(0) : undefined}
        submitLabel={isRequest ? 'Send request' : 'Send offer'}
        messageLabel={`Message to ${selected.personName.split(' ')[0]} (optional)`}
        onBackFromStart={isRequest ? () => setReasonDone(false) : canChangePerson ? () => setChosen(null) : undefined}
        reviewExtras={
          isRequest ? (
            <p className="rounded-2xl bg-brand-soft px-4 py-3 text-sm text-on-brand-soft">
              <span className="font-semibold">For:</span> {reason.trim()}
            </p>
          ) : (
            <TextField
              label="What’s it for? (optional)"
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Car repairs"
            />
          )
        }
        onSubmit={async (input) => {
          const loanId = await createLoan(selected.relationshipId, reason, input)
          navigate(`/loans/${loanId}`, { replace: true, state: { flash: isRequest ? 'Request sent.' : 'Offer sent.' } })
        }}
      />
    </div>
  )
}
