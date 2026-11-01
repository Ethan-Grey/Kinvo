import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { createLoan } from '../../data/loans'
import { listPeople, type Connection } from '../../data/people'
import { useAsync } from '../../shared/useAsync'
import { Card, Notice, Select, Spinner, TextField } from '../../shared/ui'
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

  if (people.status === 'loading') return <Spinner label="Loading…" />
  if (people.status === 'error') return <Notice tone="error">{people.error.message}</Notice>

  const counterparties: Counterparty[] = [
    ...people.data.lenders.map((p) => ({ ...p, myRole: 'borrower' as const })),
    ...people.data.borrowers.map((p) => ({ ...p, myRole: 'lender' as const })),
  ]

  if (counterparties.length === 0) {
    return (
      <Card className="space-y-3">
        <h1 className="text-xl font-semibold">No one to lend with yet</h1>
        <p className="text-sm text-ink-muted">You need to be connected through an invite link first.</p>
        <Link to="/loans" className="text-sm font-medium text-brand-ink underline">
          Back to loans
        </Link>
      </Card>
    )
  }

  const selected = counterparties.find((p) => p.relationshipId === chosen) ?? counterparties[0]
  if (!selected) return null
  const isRequest = selected.myRole === 'borrower'

  return (
    <div className="space-y-5">
      <Link to="/loans" className="text-sm text-ink-muted hover:text-ink">
        ← Loans
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight">
        {isRequest ? `Ask ${selected.personName} for a loan` : `Offer ${selected.personName} a loan`}
      </h1>

      <Card className="space-y-5">
        {counterparties.length > 1 && (
          <Select
            label="With"
            value={selected.relationshipId}
            onChange={(e) => setChosen(e.target.value)}
            options={counterparties.map((p) => ({
              value: p.relationshipId,
              label: p.myRole === 'borrower' ? `${p.personName} (lends to you)` : `${p.personName} (borrows from you)`,
            }))}
          />
        )}
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
