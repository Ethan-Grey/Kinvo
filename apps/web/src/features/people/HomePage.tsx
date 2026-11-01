import { useLocation } from 'react-router'
import { getMyProfile, listPeople, type Connection } from '../../data/people'
import { useAsync } from '../../shared/useAsync'
import { Card, Notice, Spinner } from '../../shared/ui'
import { useAuth } from '../auth/useAuth'
import { InvitePanel } from '../invites/InvitePanel'

/**
 * Signed-in home screen for M2: who you're connected to, and (for lenders)
 * invite management. Loan dashboards replace most of this in M5.
 */
export function HomePage() {
  const { session } = useAuth()
  const userId = session?.user.id ?? ''
  const location = useLocation()
  const justJoined = (location.state as { joined?: boolean } | null)?.joined === true

  const [data] = useAsync(
    async () => {
      const [profile, people] = await Promise.all([getMyProfile(userId), listPeople(userId)])
      return { profile, people }
    },
    userId,
  )

  if (data.status === 'loading') return <Spinner label="Loading…" />
  if (data.status === 'error') return <Notice tone="error">{data.error.message}</Notice>

  const { profile, people } = data.data

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Kia ora, {profile.display_name}</h1>
        <p className="text-sm text-ink-muted">{profile.email}</p>
      </div>

      {justJoined && <Notice tone="success">You’re connected. Loan requests arrive in the next update.</Notice>}

      <PeopleList
        title="People who lend to you"
        people={people.lenders}
        empty="Nobody yet. Ask someone for an invite link."
      />

      {profile.can_lend && (
        <>
          <PeopleList
            title="People you lend to"
            people={people.borrowers}
            empty="No borrowers yet. Create an invite link below."
          />
          <InvitePanel />
        </>
      )}
    </div>
  )
}

const sinceFormat = new Intl.DateTimeFormat('en-NZ', { month: 'short', year: 'numeric', timeZone: 'Pacific/Auckland' })

function PeopleList({ title, people, empty }: { title: string; people: Connection[]; empty: string }) {
  return (
    <Card>
      <h2 className="font-semibold">{title}</h2>
      {people.length === 0 ? (
        <p className="mt-2 text-sm text-ink-muted">{empty}</p>
      ) : (
        <ul className="mt-3 divide-y divide-line">
          {people.map((person) => (
            <li key={person.relationshipId} className="flex items-center gap-3 py-2.5">
              <Avatar name={person.personName} />
              <div>
                <p className="font-medium">{person.personName}</p>
                <p className="text-xs text-ink-muted">Connected {sinceFormat.format(new Date(person.since))}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

function Avatar({ name }: { name: string }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('')
  return (
    <span
      aria-hidden="true"
      className="flex size-9 items-center justify-center rounded-full bg-brand-soft text-sm font-semibold text-brand"
    >
      {initials || '?'}
    </span>
  )
}
