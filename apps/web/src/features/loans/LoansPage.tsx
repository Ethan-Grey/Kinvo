import { useAuth } from '../auth/useAuth'
import { LoansSection } from './LoansSection'

/** Loans tab: every loan, with anything waiting on the user first. */
export function LoansPage() {
  const { session } = useAuth()
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold tracking-tight">Loans</h1>
      <LoansSection userId={session?.user.id ?? ''} canStartLoan />
    </div>
  )
}
