import { useState, type FormEvent } from 'react'
import { useParams } from 'react-router'
import { addDays, todayInNZ, type IsoDate } from '../../domain/dates'
import { formatCents } from '../../domain/money'
import type { ReminderRepeat } from '../../data/database.types'
import { listLoans, type LoanSummary } from '../../data/loans'
import { listPeople } from '../../data/people'
import {
  cancelCustomReminder,
  createCustomReminder,
  formatHour,
  getReminderSettings,
  listCustomReminders,
  REPEAT_LABELS,
  saveReminderSettings,
  type CustomReminder,
  type ReminderSettings,
} from '../../data/reminders'
import { useAsync } from '../../shared/useAsync'
import { Button, Card, Notice, PageHeader, PageSkeleton, Select, Switch, TextArea, TextField } from '../../shared/ui'
import { useAuth } from '../auth/useAuth'

const HOURS = Array.from({ length: 24 }, (_, h) => ({ value: String(h), label: formatHour(h) }))

const OVERDUE_GAPS = [
  { value: '1', label: 'Every day' },
  { value: '2', label: 'Every 2 days' },
  { value: '3', label: 'Every 3 days' },
  { value: '7', label: 'Every week' },
  { value: '14', label: 'Every fortnight' },
  { value: '30', label: 'Every 30 days' },
]

const nextAtParts = new Intl.DateTimeFormat('en-NZ', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  hourCycle: 'h23',
  timeZone: 'Pacific/Auckland',
})

/** "Tue 10 Nov, 6pm" in NZ time. */
function formatNextAt(iso: string): string {
  const part = (type: string) => nextAtParts.formatToParts(new Date(iso)).find((p) => p.type === type)?.value ?? ''
  return `${part('weekday')} ${part('day')} ${part('month')}, ${formatHour(Number(part('hour')) % 24)}`
}

/**
 * /people/:relationshipId/reminders — lender only. When Kinvo reminds this
 * borrower, which reminders they get, and the lender's own reminders (ADR-0018).
 */
export function RemindersPage() {
  const { relationshipId = '' } = useParams()
  const { session } = useAuth()
  const userId = session?.user.id ?? ''

  const [data, reload] = useAsync(async () => {
    const [people, settings, reminders, loans] = await Promise.all([
      listPeople(userId),
      getReminderSettings(relationshipId),
      listCustomReminders(relationshipId),
      listLoans(userId),
    ])
    return {
      person: people.borrowers.find((p) => p.relationshipId === relationshipId) ?? null,
      settings,
      reminders,
      loans: loans.filter((l) => l.relationshipId === relationshipId && l.status === 'active'),
    }
  }, `${relationshipId}:${userId}`)

  if (data.status === 'loading') return <PageSkeleton label="Loading reminders" />
  if (data.status === 'error') return <Notice tone="error">{data.error.message}</Notice>

  const { person, settings, reminders, loans } = data.data
  if (!person) return <Notice tone="error">Only the person lending can set reminders.</Notice>
  const first = person.personName.split(' ')[0] ?? person.personName

  return (
    <div className="space-y-6">
      <PageHeader
        back={{ to: `/people/${relationshipId}`, label: person.personName }}
        title={`Reminders for ${first}`}
      />
      <AutomaticReminders relationshipId={relationshipId} first={first} initial={settings} />
      <CustomReminders
        first={first}
        reminders={reminders}
        loans={loans}
        relationshipId={relationshipId}
        onChanged={reload}
      />
    </div>
  )
}

function AutomaticReminders({
  relationshipId,
  first,
  initial,
}: {
  relationshipId: string
  first: string
  initial: ReminderSettings
}) {
  const [settings, setSettings] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)
  const set = (patch: Partial<ReminderSettings>) => {
    setSettings((s) => ({ ...s, ...patch }))
    setStatus(null)
  }

  async function handleSave(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setStatus(null)
    try {
      await saveReminderSettings(relationshipId, settings)
      setStatus({ tone: 'success', text: 'Saved.' })
    } catch (err) {
      setStatus({ tone: 'error', text: (err as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <form onSubmit={handleSave} className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Payment reminders</h2>
          <p className="text-sm text-ink-muted">Kinvo sends these to {first} for every loan with you.</p>
        </div>
        <Select
          label="Send them at"
          options={HOURS}
          value={String(settings.sendHour)}
          onChange={(e) => set({ sendHour: Number(e.target.value) })}
        />
        <div className="divide-y divide-line">
          <Switch label="The day before" checked={settings.dayBefore} onChange={(v) => set({ dayBefore: v })} />
          <Switch label="On the day it’s due" checked={settings.onTheDay} onChange={(v) => set({ onTheDay: v })} />
          <Switch
            label="When a payment is late"
            checked={settings.whenOverdue}
            onChange={(v) => set({ whenOverdue: v })}
          />
        </div>
        {settings.whenOverdue && (
          <Select
            label="Repeat late reminders"
            options={
              OVERDUE_GAPS.some((g) => g.value === String(settings.overdueEveryDays))
                ? OVERDUE_GAPS
                : [
                    ...OVERDUE_GAPS,
                    { value: String(settings.overdueEveryDays), label: `Every ${settings.overdueEveryDays} days` },
                  ]
            }
            value={String(settings.overdueEveryDays)}
            onChange={(e) => set({ overdueEveryDays: Number(e.target.value) })}
          />
        )}
        <p className="text-xs text-ink-muted">You’ll always be told when one of {first}’s payments is late.</p>
        {status && <Notice tone={status.tone}>{status.text}</Notice>}
        <Button type="submit" className="w-full" busy={busy}>
          Save
        </Button>
      </form>
    </Card>
  )
}

function CustomReminders({
  first,
  reminders,
  loans,
  relationshipId,
  onChanged,
}: {
  first: string
  reminders: CustomReminder[]
  loans: LoanSummary[]
  relationshipId: string
  onChanged: () => void
}) {
  return (
    <section className="space-y-3" aria-labelledby="own-reminders">
      <div>
        <h2 id="own-reminders" className="text-lg font-semibold">
          Your own reminders
        </h2>
        <p className="text-sm text-ink-muted">A message from you, sent to {first} when you choose.</p>
      </div>
      {reminders.length > 0 && (
        <ul className="space-y-2">
          {reminders.map((r) => (
            <ReminderRow key={r.id} reminder={r} onChanged={onChanged} />
          ))}
        </ul>
      )}
      <NewReminder first={first} loans={loans} relationshipId={relationshipId} onCreated={onChanged} />
    </section>
  )
}

function ReminderRow({ reminder, onChanged }: { reminder: CustomReminder; onChanged: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleCancel() {
    setBusy(true)
    setError(null)
    try {
      await cancelCustomReminder(reminder.id)
      onChanged()
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  return (
    <li className="space-y-2 rounded-2xl border border-line p-4">
      <p className="font-medium break-words">“{reminder.message}”</p>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-ink-muted">
          {reminder.nextAt && <>Next {formatNextAt(reminder.nextAt)}</>}
          {reminder.repeat !== 'never' && <>, {REPEAT_LABELS[reminder.repeat].toLowerCase()}</>}
        </p>
        <Button variant="ghost" className="min-h-10 px-3 text-sm" busy={busy} onClick={handleCancel}>
          Cancel<span className="sr-only"> reminder “{reminder.message}”</span>
        </Button>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
    </li>
  )
}

function NewReminder({
  first,
  loans,
  relationshipId,
  onCreated,
}: {
  first: string
  loans: LoanSummary[]
  relationshipId: string
  onCreated: () => void
}) {
  const today = todayInNZ()
  const [message, setMessage] = useState('')
  const [firstOn, setFirstOn] = useState<IsoDate>(addDays(today, 1))
  const [hour, setHour] = useState(9)
  const [repeat, setRepeat] = useState<ReminderRepeat>('never')
  const [loanId, setLoanId] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!message.trim()) {
      setStatus({ tone: 'error', text: 'Write a message for the reminder.' })
      return
    }
    setBusy(true)
    setStatus(null)
    try {
      await createCustomReminder(relationshipId, {
        message,
        firstOn,
        sendHour: hour,
        repeat,
        loanId: loanId || null,
      })
      setMessage('')
      setStatus({ tone: 'success', text: `Reminder set. ${first} will get it at ${formatHour(hour)}.` })
      onCreated()
    } catch (err) {
      setStatus({ tone: 'error', text: (err as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <form onSubmit={handleSubmit} className="space-y-4">
        <h3 className="font-semibold">Add a reminder</h3>
        <TextArea
          label="Message"
          maxLength={200}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="e.g. Pay day tomorrow, don’t forget the $50"
          hint={`${message.length}/200`}
        />
        <div className="flex gap-2">
          <TextField
            label="Date"
            type="date"
            min={today}
            value={firstOn}
            onChange={(e) => setFirstOn(e.target.value)}
            className="min-w-0 flex-1"
          />
          <Select
            label="Time"
            options={HOURS}
            value={String(hour)}
            onChange={(e) => setHour(Number(e.target.value))}
            className="w-28"
          />
        </div>
        <Select
          label="Repeat"
          options={(Object.keys(REPEAT_LABELS) as ReminderRepeat[]).map((value) => ({
            value,
            label: REPEAT_LABELS[value],
          }))}
          value={repeat}
          onChange={(e) => setRepeat(e.target.value as ReminderRepeat)}
        />
        {loans.length > 0 && (
          <Select
            label="About a loan (optional)"
            options={[
              { value: '', label: 'No particular loan' },
              ...loans.map((l) => ({ value: l.id, label: `Loan of ${formatCents(l.principalCents)}` })),
            ]}
            value={loanId}
            onChange={(e) => setLoanId(e.target.value)}
          />
        )}
        {loanId && <p className="text-xs text-ink-muted">It stops by itself once that loan is paid off.</p>}
        {status && <Notice tone={status.tone}>{status.text}</Notice>}
        <Button type="submit" className="w-full" busy={busy}>
          Set reminder
        </Button>
      </form>
    </Card>
  )
}
