import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { Avatar } from '../../shared/Avatar'
import { ChevronIcon, PeopleIcon } from '../../shared/icons'
import { createLoan } from '../../data/loans'
import { toCents } from '../../domain/money'
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

  // "Ask to borrow" from the + menu only offers lenders, "Offer a loan" only borrowers.
  const preferredRole = params.get('as')
  const candidates = counterparties.filter((p) => !preferredRole || p.myRole === preferredRole)
  const pool = candidates.length > 0 ? candidates : counterparties
  const selected = pool.find((p) => p.relationshipId === chosen) ?? (pool.length === 1 ? pool[0] : undefined)

  if (!selected) {
    return (
      <div className="space-y-6">
        <PageHeader back={{ to: '/loans', label: 'Loans' }} title="Who with?" />
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
                    {p.myRole === 'borrower' ? 'Ask them to lend to you' : 'Offer them a loan'}
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

  return (
    <div className="space-y-6">
      <PageHeader
        back={{ to: '/loans', label: 'Loans' }}
        title={
          isRequest
            ? `Ask ${selected.personName.split(' ')[0]} for a loan`
            : `Offer ${selected.personName.split(' ')[0]} a loan`
        }
      />
      <TermsForm
        key={selected.relationshipId}
        perspective={selected.myRole}
        fixedCharge={isRequest ? () => toCents(0) : undefined}
        submitLabel={isRequest ? 'Send request' : 'Send offer'}
        messageLabel={`Message to ${selected.personName.split(' ')[0]} (optional)`}
        onBackFromStart={canChangePerson ? () => setChosen(null) : undefined}
        reviewExtras={
          <TextField
            label="What’s it for? (optional)"
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Car repairs"
          />
        }
        onSubmit={async (input) => {
          const loanId = await createLoan(selected.relationshipId, reason, input)
          navigate(`/loans/${loanId}`, { replace: true, state: { flash: isRequest ? 'Request sent.' : 'Offer sent.' } })
        }}
      />
    </div>
  )
}
