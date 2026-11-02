import { useEffect } from 'react'
import { Link, useLocation } from 'react-router'
import { formatCents } from '../../domain/money'
import { describeTrackRecord, listBorrowerRecords, type BorrowerRecord } from '../../data/dashboard'
import { listLoans, type LoanSummary } from '../../data/loans'
import { getMyProfile, listPeople, type Connection } from '../../data/people'
import { RingAvatar } from '../../shared/Avatar'
import { ChevronIcon, PeopleIcon } from '../../shared/icons'
import { useAsync } from '../../shared/useAsync'
import { Badge, EmptyState, Notice, PageHeader, PageSkeleton, SectionHeader } from '../../shared/ui'
import { useAuth } from '../auth/useAuth'
import { InvitePanel } from '../invites/InvitePanel'

/**
 * People: who you lend to (with their track record, visible only to you),
 * who lends to you, and invite links.
 */
export function PeoplePage() {
  const { session } = useAuth()
  const userId = session?.user.id ?? ''
  const { hash } = useLocation()
  const [data] = useAsync(async () => {
    const [profile, people, records, loans] = await Promise.all([
      getMyProfile(userId),
      listPeople(userId),
      listBorrowerRecords(),
      listLoans(userId),
    ])
    return { profile, people, records, loans }
  }, userId)

  // "Invite someone" in the + menu links to /people#invite.
  const ready = data.status === 'success'
  useEffect(() => {
    if (ready && hash) document.getElementById(hash.slice(1))?.scrollIntoView({ block: 'start' })
  }, [ready, hash])

  if (data.status === 'loading') return <PageSkeleton label="Loading people" />
  if (data.status === 'error') return <Notice tone="error">{data.error.message}</Notice>

  const { profile, people, records, loans } = data.data
  const recordFor = (relationshipId: string) => records.find((r) => r.relationshipId === relationshipId)
  const nobody = people.borrowers.length === 0 && people.lenders.length === 0

  return (
    <div className="space-y-7">
      <PageHeader back={{ to: '/', label: 'Home' }} title="People" />

      {nobody && (
        <EmptyState icon={<PeopleIcon className="size-6" />} title="No one here yet">
          {profile.can_lend
            ? 'Create an invite link below and send it to someone in your family.'
            : 'Ask the person lending to you for an invite link.'}
        </EmptyState>
      )}

      {people.borrowers.length > 0 && (
        <section className="space-y-3">
          <SectionHeader title="You lend to" />
          <ul className="space-y-2">
            {people.borrowers.map((person) => (
              <PersonRow
                key={person.relationshipId}
                person={person}
                loans={loans}
                record={recordFor(person.relationshipId)}
              />
            ))}
          </ul>
        </section>
      )}

      {people.lenders.length > 0 && (
        <section className="space-y-3">
          <SectionHeader title="Lends to you" />
          <ul className="space-y-2">
            {people.lenders.map((person) => (
              <PersonRow key={person.relationshipId} person={person} loans={loans} />
            ))}
          </ul>
        </section>
      )}

      {profile.can_lend && (
        <div id="invite" className="scroll-mt-6">
          <InvitePanel />
        </div>
      )}
    </div>
  )
}

/** Repaid share of this person's active loans, or null if no money has moved. */
function progressWith(relationshipId: string, loans: LoanSummary[]): { progress: number | null; overdue: boolean } {
  let paid = 0
  let total = 0
  let overdue = false
  for (const loan of loans) {
    if (loan.relationshipId !== relationshipId || loan.status !== 'active' || !loan.balance) continue
    paid += loan.balance.paidCents
    total += loan.balance.totalCents
    overdue ||= loan.balance.overdueCount > 0
  }
  return { progress: total === 0 ? null : paid / total, overdue }
}

const monthYear = new Intl.DateTimeFormat('en-NZ', { month: 'short', year: 'numeric', timeZone: 'Pacific/Auckland' })

function PersonRow({ person, loans, record }: { person: Connection; loans: LoanSummary[]; record?: BorrowerRecord }) {
  const { progress, overdue } = progressWith(person.relationshipId, loans)
  return (
    <li>
      <Link
        to={`/people/${person.relationshipId}`}
        className="flex items-center gap-3 rounded-3xl border border-line p-3 pr-4 transition hover:border-brand-ink active:scale-[0.99]"
      >
        <RingAvatar name={person.personName} photo={person.personPhoto} progress={progress} overdue={overdue} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{person.personName}</p>
          <p className="truncate text-sm text-ink-muted">
            {record ? describeTrackRecord(record) : `Connected ${monthYear.format(new Date(person.since))}`}
          </p>
        </div>
        {record && record.overdueCents > 0 ? (
          <Badge tone="danger">{formatCents(record.overdueCents)} overdue</Badge>
        ) : record && record.owedCents > 0 ? (
          <span className="font-display text-lg font-semibold tabular-nums">{formatCents(record.owedCents)}</span>
        ) : (
          <ChevronIcon className="size-5 text-ink-muted" />
        )}
      </Link>
    </li>
  )
}
