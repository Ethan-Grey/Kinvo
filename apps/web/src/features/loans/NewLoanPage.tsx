import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { Avatar } from '../../shared/Avatar'
import { PeopleIcon } from '../../shared/icons'
import { createLoan } from '../../data/loans'
import { listPeople, type Connection } from '../../data/people'
import { useAsync } from '../../shared/useAsync'
import { Card, EmptyState, Notice, PageHeader, PageSkeleton, TextField } from '../../shared/ui'
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
          title="No one to lend with yet"
          action={
            <Link to="/loans" className="text-sm font-medium text-brand-ink underline">
              Back to loans
            </Link>
          }
        >
          You need to be connected through an invite link first.
        </EmptyState>
      </Card>
    )
  }

  const preferredRole = params.get('as')
  const selected =
    counterparties.find((p) => p.relationshipId === chosen) ??
    counterparties.find((p) => p.myRole === preferredRole) ??
    counterparties[0]
  if (!selected) return null
  const isRequest = selected.myRole === 'borrower'

  return (
    <div className="space-y-5">
      <PageHeader
        back={{ to: '/loans', label: 'Loans' }}
        title={isRequest ? `Ask ${selected.personName} for a loan` : `Offer ${selected.personName} a loan`}
      />

      {counterparties.length > 1 && (
        <div role="radiogroup" aria-label="With" className="relative -mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
          {counterparties.map((p) => {
            const isSelected = p.relationshipId === selected.relationshipId
            return (
              <button
                key={p.relationshipId}
                type="button"
                role="radio"
                aria-checked={isSelected}
                onClick={() => setChosen(p.relationshipId)}
                className={
                  'flex w-24 shrink-0 flex-col items-center rounded-3xl border-2 px-2 py-3 text-center transition ' +
                  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-ink ' +
                  (isSelected ? 'border-brand' : 'border-line hover:border-brand-ink')
                }
              >
                <Avatar name={p.personName} size="lg" />
                <span className="mt-2 w-full truncate text-sm font-semibold">{p.personName.split(' ')[0]}</span>
                <span className="text-xs text-ink-muted">{p.myRole === 'borrower' ? 'Lends to you' : 'Borrows'}</span>
              </button>
            )
          })}
        </div>
      )}

      <Card className="space-y-5">
        <TextField
          label="What’s it for? (optional)"
          maxLength={500}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. Car repairs"
        />
        <TermsForm
          key={selected.relationshipId}
          submitLabel={isRequest ? 'Send request' : 'Send offer'}
          messageLabel={`Message to ${selected.personName} (optional)`}
          onSubmit={async (input) => {
            const loanId = await createLoan(selected.relationshipId, reason, input)
            navigate(`/loans/${loanId}`, { replace: true })
          }}
        />
      </Card>
    </div>
  )
}
