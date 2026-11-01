import { Link } from 'react-router'
import { formatCents } from '../../domain/money'
import { describeTrackRecord, listBorrowerRecords, type BorrowerRecord } from '../../data/dashboard'
import { getMyProfile, listPeople, type Connection } from '../../data/people'
import { useAsync } from '../../shared/useAsync'
import { Badge, Card, Notice, Spinner } from '../../shared/ui'
import { useAuth } from '../auth/useAuth'
import { InvitePanel } from '../invites/InvitePanel'
import { Avatar } from './Avatar'

/**
 * People tab: who lends to you, who you lend to (with their track record,
 * visible only to you), and invite links.
 */
export function PeoplePage() {
  const { session } = useAuth()
  const userId = session?.user.id ?? ''
  const [data] = useAsync(async () => {
    const [profile, people, records] = await Promise.all([getMyProfile(userId), listPeople(userId), listBorrowerRecords()])
    return { profile, people, records }
  }, userId)

  if (data.status === 'loading') return <Spinner label="Loading…" />
  if (data.status === 'error') return <Notice tone="error">{data.error.message}</Notice>

  const { profile, people, records } = data.data
  const recordFor = (relationshipId: string) => records.find((r) => r.relationshipId === relationshipId)

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold tracking-tight">People</h1>

      {profile.can_lend && (
        <Card>
          <h2 className="font-semibold">You lend to</h2>
          {people.borrowers.length === 0 ? (
            <p className="mt-2 text-sm text-ink-muted">No one yet. Create an invite link below.</p>
          ) : (
            <ul className="mt-3 divide-y divide-line">
              {people.borrowers.map((person) => (
                <PersonRow key={person.relationshipId} person={person} record={recordFor(person.relationshipId)} />
              ))}
            </ul>
          )}
        </Card>
      )}

      <Card>
        <h2 className="font-semibold">Lends to you</h2>
        {people.lenders.length === 0 ? (
          <p className="mt-2 text-sm text-ink-muted">No one yet. Ask someone for an invite link.</p>
        ) : (
          <ul className="mt-3 divide-y divide-line">
            {people.lenders.map((person) => (
              <PersonRow key={person.relationshipId} person={person} />
            ))}
          </ul>
        )}
      </Card>

      {profile.can_lend && <InvitePanel />}
    </div>
  )
}

function PersonRow({ person, record }: { person: Connection; record?: BorrowerRecord }) {
  return (
    <li>
      <Link to={`/people/${person.relationshipId}`} className="flex items-center gap-3 py-3 hover:opacity-80">
        <Avatar name={person.personName} />
        <div className="min-w-0 flex-1">
          <p className="font-medium">{person.personName}</p>
          <p className="truncate text-xs text-ink-muted">
            {record ? describeTrackRecord(record) : `Connected ${new Date(person.since).toLocaleDateString('en-NZ', { month: 'short', year: 'numeric' })}`}
          </p>
        </div>
        {record && record.overdueCents > 0 ? (
          <Badge tone="danger">{formatCents(record.overdueCents)} overdue</Badge>
        ) : record && record.owedCents > 0 ? (
          <span className="text-sm font-medium tabular-nums">{formatCents(record.owedCents)}</span>
        ) : null}
      </Link>
    </li>
  )
}
