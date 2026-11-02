import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { RingAvatar } from '../../shared/Avatar'
import { PlusIcon } from '../../shared/icons'
import { formatCents } from '../../domain/money'
import { describeTrackRecord, listBorrowerRecords, type BorrowerRecord } from '../../data/dashboard'
import { listLoans } from '../../data/loans'
import { endRelationship, listPeople } from '../../data/people'
import { useAsync } from '../../shared/useAsync'
import { BackLink, Button, Card, Notice, PageSkeleton, SectionHeader, Stat } from '../../shared/ui'
import { useAuth } from '../auth/useAuth'
import { LoanList } from '../loans/LoansSection'

/**
 * /people/:relationshipId — one person: their track record (if you lend to
 * them; only you can see it) and every loan between you.
 */
export function PersonPage() {
  const { relationshipId = '' } = useParams()
  const { session } = useAuth()
  const userId = session?.user.id ?? ''

  const [data] = useAsync(async () => {
    const [people, records, loans] = await Promise.all([listPeople(userId), listBorrowerRecords(), listLoans(userId)])
    const asLender = people.borrowers.find((p) => p.relationshipId === relationshipId)
    const asBorrower = people.lenders.find((p) => p.relationshipId === relationshipId)
    return {
      person: asLender ?? asBorrower ?? null,
      iLend: Boolean(asLender),
      record: records.find((r) => r.relationshipId === relationshipId) ?? null,
      loans: loans.filter((l) => l.relationshipId === relationshipId),
    }
  }, `${relationshipId}:${userId}`)

  if (data.status === 'loading') return <PageSkeleton label="Loading person" />
  if (data.status === 'error') return <Notice tone="error">{data.error.message}</Notice>

  const { person, iLend, record, loans } = data.data
  if (!person) return <Notice tone="error">You’re not connected with this person.</Notice>

  return (
    <div className="space-y-5">
      <BackLink to="/people" label="People" />
      <section className="flex flex-col items-center text-center">
        <RingAvatar
          name={person.personName}
          photo={person.personPhoto}
          progress={
            record && record.totalRepaidCents + record.owedCents > 0
              ? record.totalRepaidCents / (record.totalRepaidCents + record.owedCents)
              : null
          }
          overdue={(record?.overdueCents ?? 0) > 0}
          size="xl"
        />
        <h1 className="mt-3 text-[1.75rem] leading-tight font-semibold">{person.personName}</h1>
        <p className="text-sm text-ink-muted">{iLend ? 'Borrows from you' : 'Lends to you'}</p>
        <Link
          to={`/loans/new?with=${relationshipId}`}
          className="mt-4 inline-flex min-h-12 items-center gap-2 rounded-2xl bg-brand px-5 font-semibold text-on-brand transition active:scale-[0.98]"
        >
          <PlusIcon className="size-5" />
          {iLend ? 'Offer a loan' : 'Ask for a loan'}
        </Link>
      </section>

      {iLend && record && <TrackRecord record={record} />}

      <section className="space-y-3">
        <SectionHeader title="Loans" />
        {loans.length === 0 ? (
          <p className="text-sm text-ink-muted">No loans with {person.personName.split(' ')[0]} yet.</p>
        ) : (
          <LoanList loans={loans} />
        )}
      </section>

      {iLend && <EndConnection relationshipId={relationshipId} name={person.personName} />}
    </div>
  )
}

function TrackRecord({ record }: { record: BorrowerRecord }) {
  const onTimePercent =
    record.instalmentsAssessed === 0 ? null : Math.round((record.instalmentsOnTime / record.instalmentsAssessed) * 100)

  return (
    <Card className="space-y-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">Track record</h2>
        <span className="text-xs text-ink-muted">Only you can see this</span>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Stat
          label="Paid on time"
          value={onTimePercent === null ? '—' : `${onTimePercent}%`}
          hint={`${record.instalmentsOnTime} of ${record.instalmentsAssessed} payments`}
        />
        <Stat
          label="Average lateness"
          value={record.averageDaysLate === null ? '—' : `${record.averageDaysLate} days`}
          hint={
            record.instalmentsLate > 0
              ? `Across ${record.instalmentsLate} late payment${record.instalmentsLate === 1 ? '' : 's'}`
              : 'Never late'
          }
        />
        <Stat
          label="Borrowed"
          value={formatCents(record.totalBorrowedCents)}
          hint={`${record.loansFunded} loan${record.loansFunded === 1 ? '' : 's'}`}
        />
        <Stat label="Repaid" value={formatCents(record.totalRepaidCents)} hint="Including charges" />
        <Stat label="Owes now" value={formatCents(record.owedCents)} tone="brand" />
        <Stat
          label="Overdue"
          value={formatCents(record.overdueCents)}
          tone={record.overdueCents > 0 ? 'danger' : 'default'}
        />
      </div>
      <p className="text-xs text-ink-muted">
        {describeTrackRecord(record)}. A payment counts as on time if it’s paid in full by its due date.
      </p>
    </Card>
  )
}

function EndConnection({ relationshipId, name }: { relationshipId: string; name: string }) {
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleEnd() {
    if (!window.confirm(`Stop lending to ${name}? Your history stays. You can invite them again later.`)) return
    setBusy(true)
    setError(null)
    try {
      await endRelationship(relationshipId)
      navigate('/people', { replace: true })
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2">
      {error && <Notice tone="error">{error}</Notice>}
      <Button variant="ghost" className="w-full" busy={busy} onClick={handleEnd}>
        Stop lending to {name}
      </Button>
    </div>
  )
}
