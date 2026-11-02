import { useSearchParams } from 'react-router'
import { listLoans, type LoanSummary } from '../../data/loans'
import { LoansIcon } from '../../shared/icons'
import { useAsync } from '../../shared/useAsync'
import { Card, EmptyState, Notice, PageHeader, PageSkeleton, Segmented } from '../../shared/ui'
import { useAuth } from '../auth/useAuth'
import { OPEN_STATUSES } from './labels'
import { LoanList, Rows } from './LoansSection'

type Filter = 'all' | 'waiting' | 'lending' | 'borrowing' | 'closed'

const FILTERS: Record<Filter, { label: string; test: (loan: LoanSummary) => boolean }> = {
  all: { label: 'All', test: () => true },
  waiting: { label: 'Needs you', test: (l) => l.awaitingMe },
  lending: { label: 'Lending', test: (l) => l.role === 'lender' && OPEN_STATUSES.has(l.status) },
  borrowing: { label: 'Borrowing', test: (l) => l.role === 'borrower' && OPEN_STATUSES.has(l.status) },
  closed: { label: 'Closed', test: (l) => !OPEN_STATUSES.has(l.status) },
}

function isFilter(value: string | null): value is Filter {
  return value !== null && value in FILTERS
}

/** Loans tab: every loan, filterable, with anything waiting on the user first. */
export function LoansPage() {
  const { session } = useAuth()
  const userId = session?.user.id ?? ''
  const [params, setParams] = useSearchParams()
  const show = params.get('show')
  const filter: Filter = isFilter(show) ? show : 'all'
  const [loans] = useAsync(() => listLoans(userId), userId)

  if (loans.status === 'loading') return <PageSkeleton label="Loading loans" />
  if (loans.status === 'error') return <Notice tone="error">{loans.error.message}</Notice>

  const all = loans.data
  const visible = all.filter(FILTERS[filter].test)
  const options = (Object.keys(FILTERS) as Filter[])
    .filter((key) => key === 'all' || key === filter || all.some(FILTERS[key].test))
    .map((key) => ({
      value: key,
      label: FILTERS[key].label,
      count: key === 'all' ? undefined : all.filter(FILTERS[key].test).length,
    }))

  return (
    <div className="space-y-5">
      <PageHeader title="Loans" />

      {all.length > 0 && options.length > 1 && (
        <Segmented
          label="Show"
          options={options}
          value={filter}
          onChange={(next) => setParams(next === 'all' ? {} : { show: next }, { replace: true })}
        />
      )}

      {all.length === 0 ? (
        <Card>
          <EmptyState icon={<LoansIcon className="size-6" />} title="No loans yet">
            Tap + below to ask for a loan, offer one, or invite someone.
          </EmptyState>
        </Card>
      ) : visible.length === 0 ? (
        <p className="py-8 text-center text-sm text-ink-muted">Nothing here right now.</p>
      ) : filter === 'all' ? (
        <LoanList loans={visible} />
      ) : (
        <Rows loans={visible} />
      )}
    </div>
  )
}
