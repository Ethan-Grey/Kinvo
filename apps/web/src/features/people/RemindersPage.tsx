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
  describeDay,
  formatHour,
  getReminderSettings,
  listCustomReminders,
  MAX_REMINDER_TIMES,
  REPEAT_LABELS,
  saveReminderSettings,
  sortTimes,
  type CustomReminder,
  type ReminderSettings,
  type ReminderTime,
} from '../../data/reminders'
import { CloseIcon, PlusIcon } from '../../shared/icons'
import { useAsync } from '../../shared/useAsync'
import {
  Button,
  Card,
  Notice,
  PageHeader,
  PageSkeleton,
  Segmented,
  Select,
  Switch,
  TextArea,
  TextField,
} from '../../shared/ui'
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

const STOP_AFTER = [
  { value: '', label: 'Never stop' },
  { value: '7', label: 'After a week late' },
  { value: '14', label: 'After 2 weeks late' },
  { value: '30', label: 'After 30 days late' },
  { value: '60', label: 'After 60 days late' },
  { value: '90', label: 'After 90 days late' },
]

const MOVE_AFTER = [1, 3, 5, 7, 14, 30].map((d) => ({
  value: String(d),
  label: d === 1 ? 'A day late' : d === 7 ? 'A week late' : `${d} days late`,
}))

const MOVE_BY = [
  { value: '7', label: 'A week after it was due' },
  { value: '14', label: '2 weeks after it was due' },
  { value: '30', label: 'A month after it was due' },
]

/** Keeps a value that isn't one of the presets selectable. */
function withValue(options: { value: string; label: string }[], value: string, label: string) {
  return options.some((o) => o.value === value) ? options : [...options, { value, label }]
}

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
  if (!person) return <Notice tone="error">Only the person who’s owed can set reminders.</Notice>
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

const DAY_OPTIONS = [-7, -3, -2, -1, 0, 1, 2, 3, 5, 7, 14].map((d) => ({ value: String(d), label: describeDay(d) }))

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
  const setTime = (index: number, patch: Partial<ReminderTime>) =>
    set({ times: settings.times.map((t, i) => (i === index ? { ...t, ...patch } : t)) })

  function addTime() {
    const last = settings.times.at(-1)
    set({
      times: [
        ...settings.times,
        { daysFromDue: last ? last.daysFromDue : 0, sendHour: last ? Math.min(23, last.sendHour + 3) : 9 },
      ],
    })
  }

  async function handleSave(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setStatus(null)
    try {
      await saveReminderSettings(relationshipId, settings)
      setSettings((s) => ({ ...s, times: sortTimes(s.times) }))
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
          <p className="text-sm text-ink-muted">
            Kinvo sends these to {first} for each payment, for everything {first} owes you. Add as many times as you
            like.
          </p>
        </div>

        {settings.times.length === 0 ? (
          <p className="rounded-2xl border border-line p-4 text-sm text-ink-muted">
            No reminders before or on the day.
          </p>
        ) : (
          <ol className="space-y-2">
            {settings.times.map((time, index) => (
              <li key={index} className="flex items-end gap-1.5">
                <Select
                  label={`Reminder ${index + 1}`}
                  options={
                    DAY_OPTIONS.some((o) => o.value === String(time.daysFromDue))
                      ? DAY_OPTIONS
                      : [...DAY_OPTIONS, { value: String(time.daysFromDue), label: describeDay(time.daysFromDue) }]
                  }
                  value={String(time.daysFromDue)}
                  onChange={(e) => setTime(index, { daysFromDue: Number(e.target.value) })}
                  className="min-w-0 flex-1"
                />
                <Select
                  label="Time"
                  options={HOURS}
                  value={String(time.sendHour)}
                  onChange={(e) => setTime(index, { sendHour: Number(e.target.value) })}
                  className="w-24 shrink-0"
                />
                <Button
                  variant="ghost"
                  className="shrink-0 px-1.5"
                  aria-label={`Remove reminder ${index + 1}`}
                  onClick={() => set({ times: settings.times.filter((_, i) => i !== index) })}
                >
                  <CloseIcon className="size-4" />
                </Button>
              </li>
            ))}
          </ol>
        )}
        {settings.times.length < MAX_REMINDER_TIMES && (
          <Button variant="secondary" onClick={addTime}>
            <PlusIcon className="size-4" />
            Add a reminder time
          </Button>
        )}

        <div className="space-y-3 border-t border-line pt-4">
          <Switch
            label="Keep reminding while late"
            description="After the last reminder above, until it’s paid."
            checked={settings.lateEveryDays !== null}
            onChange={(on) => set({ lateEveryDays: on ? 7 : null })}
          />
          {settings.lateEveryDays !== null && (
            <div className="flex gap-2">
              <Select
                label="How often"
                options={
                  OVERDUE_GAPS.some((g) => g.value === String(settings.lateEveryDays))
                    ? OVERDUE_GAPS
                    : [
                        ...OVERDUE_GAPS,
                        { value: String(settings.lateEveryDays), label: `Every ${settings.lateEveryDays} days` },
                      ]
                }
                value={String(settings.lateEveryDays)}
                onChange={(e) => set({ lateEveryDays: Number(e.target.value) })}
                className="min-w-0 flex-1"
              />
              <Select
                label="Time"
                options={HOURS}
                value={String(settings.lateHour)}
                onChange={(e) => set({ lateHour: Number(e.target.value) })}
                className="w-28"
              />
            </div>
          )}
        </div>
        {settings.lateEveryDays !== null && (
          <Select
            label="Stop reminding"
            options={withValue(
              STOP_AFTER,
              String(settings.lateUntilDays ?? ''),
              `After ${settings.lateUntilDays} days late`,
            )}
            value={String(settings.lateUntilDays ?? '')}
            onChange={(e) => set({ lateUntilDays: e.target.value ? Number(e.target.value) : null })}
          />
        )}

        <div className="space-y-3 border-t border-line pt-4">
          <Switch
            label="Move late payments"
            description="Give a late payment a new date instead of leaving it overdue. It stays marked as overdue until it’s paid."
            checked={settings.moveAfterDays !== null}
            onChange={(on) => set({ moveAfterDays: on ? 3 : null })}
          />
          {settings.moveAfterDays !== null && (
            <>
              <Select
                label="Once it’s"
                options={withValue(MOVE_AFTER, String(settings.moveAfterDays), `${settings.moveAfterDays} days late`)}
                value={String(settings.moveAfterDays)}
                onChange={(e) => set({ moveAfterDays: Number(e.target.value) })}
              />
              <Select
                label="Move it to"
                options={withValue(
                  MOVE_BY,
                  String(settings.moveByDays),
                  `${settings.moveByDays} days after it was due`,
                )}
                value={String(settings.moveByDays)}
                onChange={(e) => set({ moveByDays: Number(e.target.value) })}
              />
              <div>
                <p className="mb-1.5 text-sm font-medium">What moves</p>
                <Segmented
                  label="What moves"
                  options={[
                    { value: 'plan', label: 'The whole plan' },
                    { value: 'one', label: 'Just that payment' },
                  ]}
                  value={settings.moveWholePlan ? 'plan' : 'one'}
                  onChange={(v) => set({ moveWholePlan: v === 'plan' })}
                />
                <p className="mt-1.5 text-xs text-ink-muted">
                  {settings.moveWholePlan
                    ? 'Every later payment moves by the same number of days.'
                    : 'Later payments keep their dates. If it lands on one, they’re combined.'}
                </p>
              </div>
            </>
          )}
        </div>
        <p className="text-xs text-ink-muted">You’ll be told when one of {first}’s payments is late or moved.</p>
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
            label="About one thing owed (optional)"
            options={[
              { value: '', label: 'Everything' },
              ...loans.map((l) => ({ value: l.id, label: `${formatCents(l.totalCents)} owed` })),
            ]}
            value={loanId}
            onChange={(e) => setLoanId(e.target.value)}
          />
        )}
        {loanId && <p className="text-xs text-ink-muted">It stops by itself once that’s paid off.</p>}
        {status && <Notice tone={status.tone}>{status.text}</Notice>}
        <Button type="submit" className="w-full" busy={busy}>
          Set reminder
        </Button>
      </form>
    </Card>
  )
}
