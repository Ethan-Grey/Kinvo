import { useState, type FormEvent } from 'react'
import { Link, useLocation, useParams } from 'react-router'
import { formatDate } from '../../domain/dates'
import { formatCents, parseDollars } from '../../domain/money'
import { listLoans } from '../../data/loans'
import {
  changeRepeatingAmount,
  FREQUENCY_LABELS,
  getRepeating,
  REPEATING_STATUS_LABELS,
  respondRepeating,
  setRepeatingStatus,
  type RepeatingDebt,
} from '../../data/repeating'
import { RepeatIcon } from '../../shared/icons'
import { useAsync } from '../../shared/useAsync'
import { Badge, Button, Card, Notice, PageHeader, PageSkeleton, TextField } from '../../shared/ui'
import { useAuth } from '../auth/useAuth'
import { LoanList } from '../loans/LoansSection'

/** /repeating/:id — one repeating debt: what, how often, and each one so far. */
export function RepeatingPage() {
  const { id = '' } = useParams()
  const { session } = useAuth()
  const userId = session?.user.id ?? ''
  const flash = (useLocation().state as { flash?: string } | null)?.flash
  const [data, reload] = useAsync(async () => {
    const [debt, loans] = await Promise.all([getRepeating(id, userId), listLoans(userId)])
    return { debt, loans: loans.filter((l) => l.repeatingDebtId === id) }
  }, `${id}:${userId}`)
  const [message, setMessage] = useState<string | null>(null)

  if (data.status === 'loading') return <PageSkeleton label="Loading" />
  if (data.status === 'error') return <Notice tone="error">{data.error.message}</Notice>
  const { debt, loans } = data.data
  const first = debt.otherPersonName.split(' ')[0] ?? debt.otherPersonName
  const done = (text: string) => {
    setMessage(text)
    reload()
  }

  return (
    <div className="space-y-5">
      <PageHeader
        back={{ to: '/loans', label: 'Owed' }}
        title={debt.description}
        subtitle={debt.role === 'lender' ? `${debt.otherPersonName} owes you` : `You owe ${debt.otherPersonName}`}
        action={<Badge tone={statusTone(debt)}>{REPEATING_STATUS_LABELS[debt.status]}</Badge>}
      />
      {flash && !message && <Notice tone="success">{flash}</Notice>}
      {message && <Notice tone="success">{message}</Notice>}

      <Card className="space-y-1">
        <p className="font-display text-[2.5rem] leading-none font-semibold tabular-nums">
          {formatCents(debt.amountCents)}
        </p>
        <p className="text-ink-muted">
          {FREQUENCY_LABELS[debt.frequency]}, from {formatDate(debt.firstOn)}
          {debt.endOn ? ` to ${formatDate(debt.endOn)}` : ''}
        </p>
        {debt.nextOn && debt.status === 'active' && (
          <p>
            Next one added <span className="font-semibold">{formatDate(debt.nextOn)}</span>
          </p>
        )}
      </Card>

      <Actions debt={debt} first={first} onDone={done} />

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">So far</h2>
        {loans.length === 0 ? <p className="text-sm text-ink-muted">None added yet.</p> : <LoanList loans={loans} />}
      </section>
    </div>
  )
}

function statusTone(debt: RepeatingDebt) {
  if (debt.status === 'active') return 'positive' as const
  if (debt.status === 'proposed') return 'warning' as const
  return 'neutral' as const
}

function Actions({ debt, first, onDone }: { debt: RepeatingDebt; first: string; onDone: (text: string) => void }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const isLender = debt.role === 'lender'

  async function run(key: string, action: () => Promise<void>, text: string, confirm?: string) {
    if (confirm && !window.confirm(confirm)) return
    setBusy(key)
    setError(null)
    try {
      await action()
      onDone(text)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const finished = debt.status === 'stopped' || debt.status === 'declined'
  if (finished) return null

  return (
    <div className="space-y-3">
      {error && <Notice tone="error">{error}</Notice>}

      {!isLender && debt.status === 'proposed' && (
        <>
          <p className="text-sm">
            Accept once and each one is added on its date, {FREQUENCY_LABELS[debt.frequency].toLowerCase()}. You can
            stop it any time.
          </p>
          <Button
            className="w-full"
            busy={busy === 'accept'}
            onClick={() => run('accept', () => respondRepeating(debt.id, true), 'Accepted.')}
          >
            Accept
          </Button>
          <Button
            variant="secondary"
            className="w-full"
            busy={busy === 'decline'}
            onClick={() => run('decline', () => respondRepeating(debt.id, false), 'Declined.')}
          >
            Decline
          </Button>
        </>
      )}

      {isLender && debt.status === 'proposed' && (
        <Notice>Waiting for {first} to accept. You’ll get an alert when they do.</Notice>
      )}

      {isLender && <ChangeAmount debt={debt} onDone={onDone} />}

      {isLender && debt.status === 'active' && (
        <Button
          variant="secondary"
          className="w-full"
          busy={busy === 'pause'}
          onClick={() => run('pause', () => setRepeatingStatus(debt.id, 'paused'), 'Paused.')}
        >
          Pause
        </Button>
      )}
      {isLender && debt.status === 'paused' && (
        <Button
          className="w-full"
          busy={busy === 'resume'}
          onClick={() => run('resume', () => setRepeatingStatus(debt.id, 'active'), 'Restarted.')}
        >
          <RepeatIcon className="size-5" />
          Restart
        </Button>
      )}
      <Button
        variant="ghost"
        className="w-full"
        busy={busy === 'stop'}
        onClick={() =>
          run(
            'stop',
            () => setRepeatingStatus(debt.id, 'stopped'),
            'Stopped.',
            `Stop ${debt.description}? No more will be added. Anything already added stays.`,
          )
        }
      >
        {debt.status === 'proposed' && isLender ? 'Cancel' : 'Stop'}
      </Button>
    </div>
  )
}

function ChangeAmount({ debt, onDone }: { debt: RepeatingDebt; onDone: (text: string) => void }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const parsed = parseDollars(text)
    if (!parsed.ok || parsed.cents < 1) return setError('Enter an amount over $0.')
    setBusy(true)
    setError(null)
    try {
      await changeRepeatingAmount(debt.id, parsed.cents)
      setOpen(false)
      onDone(`Changed to ${formatCents(parsed.cents)} from the next one.`)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <Button variant="secondary" className="w-full" onClick={() => setOpen(true)}>
        Change the amount
      </Button>
    )
  }
  return (
    <Card>
      <form onSubmit={handleSubmit} className="space-y-3">
        <TextField
          label="New amount ($)"
          inputMode="decimal"
          value={text}
          onChange={(e) => setText(e.target.value)}
          hint="Applies from the next one. Ones already added stay the same."
          autoFocus
        />
        {error && <Notice tone="error">{error}</Notice>}
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button type="submit" className="flex-1" busy={busy}>
            Save
          </Button>
        </div>
      </form>
    </Card>
  )
}

/** Repeating debts as a short list, for the Owed page and a person's page. */
export function RepeatingList({ debts }: { debts: RepeatingDebt[] }) {
  return (
    <ul className="space-y-2">
      {debts.map((d) => (
        <li key={d.id}>
          <Link
            to={`/repeating/${d.id}`}
            className="flex items-center gap-3 rounded-3xl border border-line bg-surface p-4 hover:border-brand-ink focus-visible:outline-2 focus-visible:outline-brand-ink"
          >
            <span
              aria-hidden="true"
              className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-soft text-on-brand-soft"
            >
              <RepeatIcon className="size-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold">
                {d.description}:{' '}
                {d.role === 'lender' ? `${d.otherPersonName} owes you` : `you owe ${d.otherPersonName}`}
              </span>
              <span className="block text-sm text-ink-muted tabular-nums">
                {formatCents(d.amountCents)} {FREQUENCY_LABELS[d.frequency].toLowerCase()}
                {d.status !== 'active' ? ` · ${REPEATING_STATUS_LABELS[d.status]}` : ''}
              </span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  )
}
