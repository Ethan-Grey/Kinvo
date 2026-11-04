import { useState, type FormEvent } from 'react'
import { Link, useLocation, useParams } from 'react-router'
import { addDays, formatDate, formatShortDate, todayInNZ, type IsoDate } from '../../domain/dates'
import { balanceOn, lowestAhead, netWith, positions, settlePlan } from '../../domain/household'
import { formatCents, formatSignedCents, parseDollars, toCents } from '../../domain/money'
import type { RepeatFrequency } from '../../data/database.types'
import {
  addSharedEntry,
  checkSharedBalance,
  createHouseholdInvite,
  createTopup,
  getHousehold,
  memberName,
  payOwnShare,
  stopTopup,
  voidSharedEntry,
  type HouseholdDetail,
} from '../../data/households'
import { FREQUENCY_LABELS } from '../../data/repeating'
import { Avatar } from '../../shared/Avatar'
import { AlertIcon, PlusIcon } from '../../shared/icons'
import { useAsync } from '../../shared/useAsync'
import {
  Badge,
  Button,
  Card,
  Notice,
  PageHeader,
  PageSkeleton,
  SectionHeader,
  Segmented,
  TextField,
} from '../../shared/ui'
import { useAuth } from '../auth/useAuth'

type Reload = () => void

/** /households/:id — the household at a glance: what needs doing, who owes who, the shared account, bills. */
export function HouseholdPage() {
  const { id = '' } = useParams()
  const { session } = useAuth()
  const me = session?.user.id ?? ''
  const flash = (useLocation().state as { flash?: string } | null)?.flash
  const [data, reload] = useAsync(() => getHousehold(id), id)

  if (data.status === 'loading') return <PageSkeleton label="Loading household" />
  if (data.status === 'error') return <Notice tone="error">{data.error.message}</Notice>
  const h = data.data

  return (
    <div className="space-y-6">
      <PageHeader
        back={{ to: '/households', label: 'Households' }}
        title={h.name}
        subtitle={h.members.map((m) => (m.userId === me ? 'You' : m.name.split(' ')[0])).join(', ')}
        action={
          <Link
            to={`/households/${h.id}/settings`}
            className="inline-flex min-h-10 items-center rounded-full border border-line px-4 text-sm font-semibold hover:border-brand-ink"
          >
            Settings
          </Link>
        }
      />
      {flash && <Notice tone="success">{flash}</Notice>}
      <NeedsYou h={h} me={me} onChanged={reload} />
      <Tab h={h} me={me} />
      {h.hasSharedAccount && <SharedAccount h={h} me={me} onChanged={reload} />}
      <Bills h={h} me={me} />
      <People h={h} me={me} />
    </div>
  )
}

function NeedsYou({ h, me, onChanged }: { h: HouseholdDetail; me: string; onChanged: Reload }) {
  const soon = addDays(todayInNZ(), 7)
  const billName = (billId: string) => h.bills.find((b) => b.id === billId)?.name ?? 'Bill'
  const amounts = h.occurrences.filter(
    (o) =>
      o.status === 'needs_amount' &&
      o.dueOn <= soon &&
      (o.method === 'shared_account' || o.method === 'each_own' || o.payerId === me),
  )
  const shares = h.occurrences.flatMap((o) =>
    o.status === 'open' && o.method === 'each_own' && o.dueOn <= soon
      ? o.shares.filter((s) => s.userId === me && !s.paid).map((s) => ({ o, s }))
      : [],
  )
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  if (amounts.length === 0 && shares.length === 0) return null

  async function pay(occurrenceId: string) {
    setBusy(occurrenceId)
    setError(null)
    try {
      await payOwnShare(occurrenceId)
      onChanged()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="space-y-3" aria-labelledby="needs-you">
      <h2 id="needs-you" className="text-lg font-semibold">
        Needs you
      </h2>
      <ul className="space-y-2">
        {amounts.map((o) => (
          <li key={o.id}>
            <Link
              to={`/households/${h.id}/bills/due/${o.id}`}
              className="flex items-center gap-3 rounded-2xl bg-attention p-4 text-on-attention"
            >
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{billName(o.billId)}: enter the amount</span>
                <span className="block text-sm">Due {formatDate(o.dueOn)}</span>
              </span>
              <span className="font-semibold">Enter</span>
            </Link>
          </li>
        ))}
        {shares.map(({ o, s }) => (
          <li key={o.id} className="flex items-center gap-3 rounded-2xl bg-attention p-4 text-on-attention">
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">
                Your {formatCents(s.amountCents)} share of {billName(o.billId)}
              </span>
              <span className="block text-sm">Due {formatDate(o.dueOn)}</span>
            </span>
            <Button
              variant="secondary"
              className="min-h-10 px-4 text-sm"
              busy={busy === o.id}
              onClick={() => pay(o.id)}
            >
              I’ve paid it
            </Button>
          </li>
        ))}
      </ul>
      {error && <Notice tone="error">{error}</Notice>}
    </section>
  )
}

function Tab({ h, me }: { h: HouseholdDetail; me: string }) {
  const others = h.members.filter((m) => m.userId !== me)
  if (others.length === 0) return null
  const plan =
    h.members.length > 2
      ? settlePlan(
          positions(
            h.tab,
            h.members.map((m) => m.userId),
          ),
        )
      : []

  return (
    <section className="space-y-3" aria-labelledby="tab-heading">
      <h2 id="tab-heading" className="text-lg font-semibold">
        Who owes who
      </h2>
      <ul className="divide-y divide-line rounded-3xl border border-line">
        {others.map((m) => {
          const net = netWith(h.tab, me, m.userId)
          const first = m.name.split(' ')[0]
          return (
            <li key={m.userId} className="flex items-center gap-3 p-4">
              <Avatar name={m.name} photo={m.photo} />
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">
                  {net === 0 ? `You and ${first} are square` : net > 0 ? `${first} owes you` : `You owe ${first}`}
                </span>
                {net !== 0 && (
                  <span className={`block font-display text-xl tabular-nums ${net < 0 ? 'text-danger' : ''}`}>
                    {formatCents(toCents(Math.abs(net)))}
                  </span>
                )}
              </span>
              {net < 0 && (
                <Link
                  to={`/households/${h.id}/settle/${m.userId}`}
                  className="inline-flex min-h-10 items-center rounded-full bg-brand px-4 text-sm font-semibold text-on-brand"
                >
                  Settle up
                </Link>
              )}
            </li>
          )
        })}
      </ul>
      {plan.length > 0 && (
        <Card className="space-y-2">
          <h3 className="font-semibold">Simplest way to settle everyone</h3>
          <ul className="space-y-1 text-sm tabular-nums">
            {plan.map((p) => (
              <li key={`${p.from}-${p.to}`}>
                {memberName(h, p.from, me)} → {memberName(h, p.to, me)}: {formatCents(p.cents)}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </section>
  )
}

function SharedAccount({ h, me, onChanged }: { h: HouseholdDetail; me: string; onChanged: Reload }) {
  const today = todayInNZ()
  const balance = balanceOn(h.sharedEntries, today)
  const lowest = lowestAhead(h.sharedEntries, today, 14)
  const [form, setForm] = useState<'check' | 'money' | 'topup' | null>(null)
  const myTopups = h.topups.filter((t) => t.memberId === me)
  const done = () => {
    setForm(null)
    onChanged()
  }

  return (
    <section className="space-y-3" aria-labelledby="shared-heading">
      <h2 id="shared-heading" className="text-lg font-semibold">
        {h.sharedAccountName ?? 'Shared account'}
      </h2>
      <Card className="space-y-4">
        <div>
          <p className="text-sm text-ink-muted">Estimated balance today</p>
          <p
            className={`font-display text-[2.5rem] leading-none font-semibold tabular-nums ${balance < 0 ? 'text-danger' : ''}`}
          >
            {formatSignedCents(balance)}
          </p>
        </div>
        {lowest.cents < 0 && (
          <Notice tone="error">
            <span className="flex items-start gap-2">
              <AlertIcon className="mt-0.5 size-4 shrink-0" />
              It could be {formatCents(toCents(-lowest.cents))} short on {formatShortDate(lowest.on)}. Top it up before
              then.
            </span>
          </Notice>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            className="min-h-10 text-sm"
            onClick={() => setForm(form === 'check' ? null : 'check')}
          >
            Check balance
          </Button>
          <Button
            variant="secondary"
            className="min-h-10 text-sm"
            onClick={() => setForm(form === 'money' ? null : 'money')}
          >
            Money in or out
          </Button>
        </div>
        {form === 'check' && <CheckBalanceForm householdId={h.id} onDone={done} />}
        {form === 'money' && <MoneyForm householdId={h.id} onDone={done} />}
      </Card>

      <Card className="space-y-3">
        <h3 className="font-semibold">Regular top-ups</h3>
        {h.topups.length === 0 ? (
          <p className="text-sm text-ink-muted">None yet. Add yours so the balance stays right.</p>
        ) : (
          <ul className="divide-y divide-line">
            {h.topups.map((t) => (
              <TopupRow
                key={t.id}
                topup={t}
                who={memberName(h, t.memberId, me)}
                mine={t.memberId === me}
                onChanged={onChanged}
              />
            ))}
          </ul>
        )}
        {form === 'topup' ? (
          <TopupForm householdId={h.id} onDone={done} onCancel={() => setForm(null)} />
        ) : (
          <Button variant="secondary" className="min-h-10 text-sm" onClick={() => setForm('topup')}>
            <PlusIcon className="size-4" />
            {myTopups.length > 0 ? 'Add another top-up' : 'Add your top-up'}
          </Button>
        )}
      </Card>

      <Activity h={h} me={me} onChanged={onChanged} />
    </section>
  )
}

function TopupRow({
  topup,
  who,
  mine,
  onChanged,
}: {
  topup: HouseholdDetail['topups'][number]
  who: string
  mine: boolean
  onChanged: Reload
}) {
  const [busy, setBusy] = useState(false)
  return (
    <li className="flex items-center gap-3 py-2">
      <span className="min-w-0 flex-1">
        <span className="block font-medium">
          {who}: {formatCents(topup.amountCents)} {FREQUENCY_LABELS[topup.frequency].toLowerCase()}
        </span>
        {topup.nextOn && <span className="block text-sm text-ink-muted">Next {formatDate(topup.nextOn)}</span>}
      </span>
      {mine && (
        <Button
          variant="ghost"
          className="min-h-10 px-3 text-sm"
          busy={busy}
          onClick={async () => {
            if (!window.confirm('Stop this top-up? Kinvo will stop adding it to the balance.')) return
            setBusy(true)
            try {
              await stopTopup(topup.id)
              onChanged()
            } finally {
              setBusy(false)
            }
          }}
        >
          Stop<span className="sr-only"> your top-up</span>
        </Button>
      )}
    </li>
  )
}

function Activity({ h, me, onChanged }: { h: HouseholdDetail; me: string; onChanged: Reload }) {
  const today = todayInNZ()
  const recent = h.sharedEntries.filter((e) => !e.voided && e.occurredOn <= today).slice(0, 15)
  const [error, setError] = useState<string | null>(null)
  if (recent.length === 0) return null
  const label = (e: HouseholdDetail['sharedEntries'][number]) =>
    e.kind === 'topup'
      ? `Top-up from ${memberName(h, e.memberId, me)}`
      : e.kind === 'bill'
        ? (e.note ?? 'Bill')
        : e.kind === 'opening'
          ? 'Starting balance'
          : e.kind === 'adjustment'
            ? 'Balance checked'
            : (e.note ?? 'Money out')

  return (
    <details className="rounded-3xl border border-line p-5">
      <summary className="cursor-pointer font-semibold">Recent activity</summary>
      {error && <Notice tone="error">{error}</Notice>}
      <ul className="mt-3 divide-y divide-line">
        {recent.map((e) => (
          <li key={e.id} className="flex items-center gap-3 py-2 text-sm">
            <span className="min-w-0 flex-1">
              <span className="block font-medium">{label(e)}</span>
              <span className="block text-ink-muted">{formatDate(e.occurredOn)}</span>
            </span>
            <span className={`font-semibold tabular-nums ${e.amountCents < 0 ? '' : 'text-positive'}`}>
              {e.amountCents > 0 ? '+' : '−'}
              {formatCents(toCents(Math.abs(e.amountCents)))}
            </span>
            {(e.kind === 'topup' || e.kind === 'withdrawal') && (e.memberId === me || e.createdBy === me) && (
              <Button
                variant="ghost"
                className="min-h-9 px-2 text-xs"
                onClick={async () => {
                  setError(null)
                  try {
                    await voidSharedEntry(e.id)
                    onChanged()
                  } catch (err) {
                    setError((err as Error).message)
                  }
                }}
              >
                {e.kind === 'topup' ? 'Missed' : 'Undo'}
                <span className="sr-only">
                  {' '}
                  {label(e).toLowerCase()} on {formatDate(e.occurredOn)}
                </span>
              </Button>
            )}
          </li>
        ))}
      </ul>
    </details>
  )
}

function useSubmit(action: () => Promise<unknown>, onDone: () => void) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function run(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await action()
      onDone()
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }
  return { busy, error, setError, run }
}

function CheckBalanceForm({ householdId, onDone }: { householdId: string; onDone: () => void }) {
  const [text, setText] = useState('')
  const parsed = parseDollars(text.replace(/^-/, ''))
  const negative = text.trim().startsWith('-')
  const { busy, error, run } = useSubmit(async () => {
    if (!parsed.ok) throw new Error('Enter the balance, like 812.50.')
    await checkSharedBalance(householdId, negative ? -parsed.cents : parsed.cents)
  }, onDone)
  return (
    <form onSubmit={run} className="space-y-3">
      <TextField
        label="What your banking app shows ($)"
        inputMode="decimal"
        value={text}
        onChange={(e) => setText(e.target.value)}
        autoFocus
      />
      {error && <Notice tone="error">{error}</Notice>}
      <Button type="submit" className="w-full" busy={busy}>
        Update balance
      </Button>
    </form>
  )
}

function MoneyForm({ householdId, onDone }: { householdId: string; onDone: () => void }) {
  const [kind, setKind] = useState<'topup' | 'withdrawal'>('topup')
  const [text, setText] = useState('')
  const [note, setNote] = useState('')
  const { busy, error, run } = useSubmit(async () => {
    const parsed = parseDollars(text)
    if (!parsed.ok || parsed.cents < 1) throw new Error('Enter an amount over $0.')
    await addSharedEntry(householdId, kind, parsed.cents, note)
  }, onDone)
  return (
    <form onSubmit={run} className="space-y-3">
      <Segmented
        label="Money in or out"
        options={[
          { value: 'topup', label: 'I put money in' },
          { value: 'withdrawal', label: 'Money taken out' },
        ]}
        value={kind}
        onChange={setKind}
      />
      <TextField label="Amount ($)" inputMode="decimal" value={text} onChange={(e) => setText(e.target.value)} />
      <TextField
        label="What for (optional)"
        maxLength={200}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder={kind === 'topup' ? 'e.g. Extra for the power bill' : 'e.g. Groceries'}
      />
      {error && <Notice tone="error">{error}</Notice>}
      <Button type="submit" className="w-full" busy={busy}>
        Save
      </Button>
    </form>
  )
}

const FREQUENCIES = (Object.keys(FREQUENCY_LABELS) as RepeatFrequency[]).map((value) => ({
  value,
  label: FREQUENCY_LABELS[value],
}))

function TopupForm({
  householdId,
  onDone,
  onCancel,
}: {
  householdId: string
  onDone: () => void
  onCancel: () => void
}) {
  const [text, setText] = useState('')
  const [frequency, setFrequency] = useState<RepeatFrequency>('weekly')
  const [firstOn, setFirstOn] = useState<string>(todayInNZ())
  const { busy, error, run } = useSubmit(async () => {
    const parsed = parseDollars(text)
    if (!parsed.ok || parsed.cents < 1) throw new Error('Enter the amount you put in each time.')
    await createTopup(householdId, parsed.cents, frequency, firstOn as IsoDate)
  }, onDone)
  return (
    <form onSubmit={run} className="space-y-3 rounded-2xl border border-line p-4">
      <TextField
        label="You put in ($)"
        inputMode="decimal"
        value={text}
        onChange={(e) => setText(e.target.value)}
        autoFocus
      />
      <Segmented label="How often" options={FREQUENCIES} value={frequency} onChange={setFrequency} />
      <TextField
        label="Next one goes in"
        type="date"
        value={firstOn}
        onChange={(e) => setFirstOn(e.target.value)}
        hint="Kinvo assumes it goes in each time. Tap Missed if one doesn’t."
      />
      {error && <Notice tone="error">{error}</Notice>}
      <div className="flex gap-2">
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" className="flex-1" busy={busy}>
          Save top-up
        </Button>
      </div>
    </form>
  )
}

function Bills({ h, me }: { h: HouseholdDetail; me: string }) {
  const today = todayInNZ()
  const horizon = addDays(today, 31)
  const upcoming = h.occurrences
    .filter((o) => o.status !== 'skipped' && o.status !== 'done' && o.dueOn <= horizon)
    .sort((a, b) => a.dueOn.localeCompare(b.dueOn))
  const billName = (billId: string) => h.bills.find((b) => b.id === billId)?.name ?? 'Bill'

  return (
    <section className="space-y-3">
      <SectionHeader title="Bills" link={{ to: `/households/${h.id}/bills/new`, label: 'Add a bill' }} />
      {h.bills.length === 0 ? (
        <Card>
          <p className="text-sm text-ink-muted">
            Add the rent and regular bills, and how each is paid. Kinvo keeps track of what’s due and who owes what.
          </p>
          <Link
            to={`/households/${h.id}/bills/new`}
            className="mt-3 flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-brand font-semibold text-on-brand"
          >
            <PlusIcon className="size-5" />
            Add a bill
          </Link>
        </Card>
      ) : (
        <>
          {upcoming.length > 0 && (
            <ul className="divide-y divide-line rounded-3xl border border-line">
              {upcoming.map((o) => (
                <li key={o.id}>
                  <Link to={`/households/${h.id}/bills/${o.billId}`} className="flex items-center gap-3 p-4">
                    <span className="flex w-12 shrink-0 flex-col items-center rounded-xl bg-brand-soft py-1 text-on-brand-soft">
                      <span className="text-[11px] font-semibold">{formatShortDate(o.dueOn).split(' ')[0]?.replace(',', '')}</span>
                      <span className="font-display text-lg leading-none font-semibold">
                        {o.dueOn.slice(8).replace(/^0/, '')}
                      </span>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{billName(o.billId)}</span>
                      <span className="block truncate text-sm text-ink-muted">
                        {o.method === 'shared_account'
                          ? 'From the shared account'
                          : o.method === 'each_own'
                            ? 'Everyone pays their share'
                            : `${memberName(h, o.payerId, me)} ${o.payerId === me ? 'pay' : 'pays'}`}
                      </span>
                    </span>
                    {o.amountCents === null ? (
                      <Badge tone="warning">Amount needed</Badge>
                    ) : (
                      <span className="font-semibold tabular-nums">{formatCents(o.amountCents)}</span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <details className="rounded-3xl border border-line p-5">
            <summary className="cursor-pointer font-semibold">All bills ({h.bills.length})</summary>
            <ul className="mt-3 divide-y divide-line">
              {h.bills.map((b) => (
                <li key={b.id}>
                  <Link to={`/households/${h.id}/bills/${b.id}`} className="flex items-center gap-3 py-3">
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{b.name}</span>
                      <span className="block text-sm text-ink-muted">
                        {b.amountType === 'fixed' && b.amountCents !== null ? formatCents(b.amountCents) : 'Changes'}{' '}
                        {FREQUENCY_LABELS[b.frequency].toLowerCase()}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </details>
        </>
      )}
    </section>
  )
}

function People({ h, me }: { h: HouseholdDetail; me: string }) {
  const [link, setLink] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  async function invite() {
    setBusy(true)
    setError(null)
    try {
      const token = await createHouseholdInvite(h.id)
      const url = `${window.location.origin}/household-invite/${token}`
      setLink(url)
      if (navigator.share) {
        try {
          await navigator.share({ title: `Join ${h.name} on Kinvo`, url })
          return
        } catch {
          /* cancelled: show the link */
        }
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="space-y-3" aria-labelledby="people-heading">
      <h2 id="people-heading" className="text-lg font-semibold">
        People
      </h2>
      <ul className="space-y-2">
        {h.members.map((m) => (
          <li key={m.userId} className="flex items-center gap-3">
            <Avatar name={m.name} photo={m.photo} />
            <span className="flex-1 font-medium">{m.userId === me ? `${m.name} (you)` : m.name}</span>
            {m.role === 'owner' && <span className="text-xs text-ink-muted">Runs it</span>}
          </li>
        ))}
      </ul>
      {link ? (
        <Card className="space-y-3">
          <p className="text-sm">Send this link to who you want to invite. It works once, for 7 days.</p>
          <p className="rounded-xl bg-brand-soft p-3 text-sm break-all text-on-brand-soft">{link}</p>
          <Button
            variant="secondary"
            className="w-full"
            onClick={async () => {
              await navigator.clipboard.writeText(link)
              setCopied(true)
            }}
          >
            {copied ? 'Copied' : 'Copy link'}
          </Button>
        </Card>
      ) : (
        <Button variant="secondary" className="w-full" busy={busy} onClick={invite}>
          <PlusIcon className="size-5" />
          Invite someone
        </Button>
      )}
      {error && <Notice tone="error">{error}</Notice>}
    </section>
  )
}
