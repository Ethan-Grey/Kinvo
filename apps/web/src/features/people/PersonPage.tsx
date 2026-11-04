import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { RingAvatar } from '../../shared/Avatar'
import { BellIcon, ChevronIcon, PlusIcon } from '../../shared/icons'
import { formatCents } from '../../domain/money'
import { describeTrackRecord, listBorrowerRecords, type BorrowerRecord } from '../../data/dashboard'
import { listLoans } from '../../data/loans'
import { endRelationship, listPeople } from '../../data/people'
import {
  describeDay,
  formatHour,
  getReminderSettings,
  listCustomReminders,
  type ReminderSettings,
} from '../../data/reminders'
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
    const reminders = asLender
      ? await Promise.all([getReminderSettings(relationshipId), listCustomReminders(relationshipId)])
      : null
    return {
      reminders: reminders && { settings: reminders[0], customCount: reminders[1].length },
      person: asLender ?? asBorrower ?? null,
      iLend: Boolean(asLender),
      record: records.find((r) => r.relationshipId === relationshipId) ?? null,
      loans: loans.filter((l) => l.relationshipId === relationshipId),
    }
  }, `${relationshipId}:${userId}`)

  if (data.status === 'loading') return <PageSkeleton label="Loading person" />
  if (data.status === 'error') return <Notice tone="error">{data.error.message}</Notice>

  const { person, iLend, record, loans, reminders } = data.data
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
        <p className="text-sm text-ink-muted">{iLend ? 'Owes you' : 'You owe them'}</p>
        <Link
          to={`/loans/new?with=${relationshipId}`}
          className="mt-4 inline-flex min-h-12 items-center gap-2 rounded-2xl bg-brand px-5 font-semibold text-on-brand transition active:scale-[0.98]"
        >
          <PlusIcon className="size-5" />
          {iLend ? 'Add what they owe' : 'Add what you owe'}
        </Link>
      </section>

      {iLend && record && <TrackRecord record={record} />}

      {reminders && (
        <RemindersLink
          relationshipId={relationshipId}
          settings={reminders.settings}
          customCount={reminders.customCount}
        />
      )}

      <section className="space-y-3">
        <SectionHeader title="Owed" />
        {loans.length === 0 ? (
          <p className="text-sm text-ink-muted">Nothing owed with {person.personName.split(' ')[0]} yet.</p>
        ) : (
          <LoanList loans={loans} />
        )}
      </section>

      {iLend && <EndConnection relationshipId={relationshipId} name={person.personName} />}
    </div>
  )
}

function describeReminders(settings: ReminderSettings): string {
  if (settings.times.length === 0 && settings.lateEveryDays === null) return 'Payment reminders are off'
  const shown = settings.times
    .slice(0, 3)
    .map((t) => `${describeDay(t.daysFromDue).toLowerCase()} at ${formatHour(t.sendHour)}`)
  const more = settings.times.length > 3 ? ` and ${settings.times.length - 3} more` : ''
  const text = shown.join(', ')
  return text ? `${text.charAt(0).toUpperCase()}${text.slice(1)}${more}` : 'Only while late'
}

function RemindersLink({
  relationshipId,
  settings,
  customCount,
}: {
  relationshipId: string
  settings: ReminderSettings
  customCount: number
}) {
  return (
    <Link
      to={`/people/${relationshipId}/reminders`}
      className="flex items-center gap-3 rounded-3xl border border-line bg-surface p-4 hover:border-brand-ink focus-visible:outline-2 focus-visible:outline-brand-ink"
    >
      <span
        aria-hidden="true"
        className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-soft text-on-brand-soft"
      >
        <BellIcon className="size-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">Reminders</span>
        <span className="block text-sm text-ink-muted">
          {describeReminders(settings)}
          {customCount > 0 && `. ${customCount} of your own`}
        </span>
      </span>
      <ChevronIcon className="size-5 shrink-0 text-ink-muted" />
    </Link>
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
          label="Paid out"
          value={formatCents(record.totalBorrowedCents)}
          hint={`${record.loansFunded} time${record.loansFunded === 1 ? '' : 's'}`}
        />
        <Stat label="Paid back" value={formatCents(record.totalRepaidCents)} hint="Including charges" />
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
    if (!window.confirm(`Disconnect from ${name}? Your history stays. You can invite them again later.`)) return
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
        Disconnect from {name}
      </Button>
    </div>
  )
}
