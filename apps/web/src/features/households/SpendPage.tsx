import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { isIsoDate, todayInNZ, type IsoDate } from '../../domain/dates'
import { equalShares, monthOf, monthSummary, shiftMonth } from '../../domain/household'
import { formatCents, parseDollars, toCents } from '../../domain/money'
import type { SpendCategory } from '../../data/database.types'
import {
  addExpense,
  CATEGORY_LABELS,
  getHousehold,
  listHouseholds,
  memberName,
  SPEND_LABELS,
  type HouseholdDetail,
} from '../../data/households'
import { BackIcon, ChevronIcon, HomeIcon } from '../../shared/icons'
import { useAsync } from '../../shared/useAsync'
import { Button, Card, EmptyState, Notice, PageHeader, PageSkeleton, Segmented, TextField } from '../../shared/ui'
import { MoneyField, QuickPicks } from '../../shared/Wizard'
import { useAuth } from '../auth/useAuth'
import { ReceiptField } from '../repayments/ReceiptField'

/** /spend — quick add from anywhere (e.g. an iPhone Back Tap shortcut). Picks the household if there's one. */
export function QuickSpendPage() {
  const [data] = useAsync(() => listHouseholds(), 'households')
  if (data.status === 'loading') return <PageSkeleton label="Loading" />
  if (data.status === 'error') return <Notice tone="error">{data.error.message}</Notice>
  const households = data.data
  if (households.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={<HomeIcon className="size-6" />}
          title="No household yet"
          action={
            <Link to="/households/new" className="text-sm font-semibold text-brand-ink underline">
              Create a household
            </Link>
          }
        >
          Spending is shared within a household.
        </EmptyState>
      </Card>
    )
  }
  if (households.length === 1 && households[0]) return <SpendLoader id={households[0].id} />
  return (
    <div className="space-y-5">
      <PageHeader title="Add spending" subtitle="Which household?" />
      <ul className="space-y-2">
        {households.map((h) => (
          <li key={h.id}>
            <Link
              to={`/households/${h.id}/spend`}
              className="flex items-center gap-3 rounded-3xl border border-line p-4 font-display text-lg font-semibold hover:border-brand-ink"
            >
              <span className="flex-1">{h.name}</span>
              <ChevronIcon className="size-5 text-ink-muted" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** /households/:id/spend */
export function SpendPage() {
  const { id = '' } = useParams()
  return <SpendLoader id={id} />
}

function SpendLoader({ id }: { id: string }) {
  const { session } = useAuth()
  const [data] = useAsync(() => getHousehold(id), id)
  if (data.status === 'loading') return <PageSkeleton label="Loading" />
  if (data.status === 'error') return <Notice tone="error">{data.error.message}</Notice>
  return <SpendForm h={data.data} me={session?.user.id ?? ''} />
}

const CATEGORIES = (Object.keys(SPEND_LABELS) as SpendCategory[]).map((value) => ({
  value,
  label: SPEND_LABELS[value],
}))

export function SpendForm({ h, me }: { h: HouseholdDetail; me: string }) {
  const navigate = useNavigate()
  const today = todayInNZ()
  const [amountText, setAmountText] = useState('')
  const [category, setCategory] = useState<SpendCategory>('groceries')
  const [description, setDescription] = useState('')
  const [paidBy, setPaidBy] = useState<string>(me)
  const [splitMode, setSplitMode] = useState<'usual' | 'custom'>('usual')
  const [percents, setPercents] = useState<Record<string, string>>(() =>
    Object.fromEntries(equalShares(h.members.map((m) => m.userId)).map((s) => [s.userId, String(s.shareBp / 100)])),
  )
  const [spentOn, setSpentOn] = useState<string>(today)
  const [receipt, setReceipt] = useState<Blob | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fromShared = paidBy === 'shared'
  const solo = h.members.length < 2
  const payers = [
    ...h.members.map((m) => ({ value: m.userId, label: memberName(h, m.userId, me) })),
    ...(h.hasSharedAccount ? [{ value: 'shared', label: h.sharedAccountName ?? 'Shared account' }] : []),
  ]

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const amount = parseDollars(amountText)
    if (!amount.ok || amount.cents < 1) return setError('Enter how much it was.')
    if (!isIsoDate(spentOn) || spentOn > today) return setError('The date can’t be in the future.')
    let split: { userId: string; shareBp: number }[] | null = null
    if (!fromShared && splitMode === 'custom') {
      split = h.members.map((m) => ({ userId: m.userId, shareBp: Math.round(Number(percents[m.userId] || 0) * 100) }))
      if (split.reduce((s, x) => s + x.shareBp, 0) !== 10000) return setError('The percentages must add up to 100.')
    }
    setBusy(true)
    setError(null)
    try {
      await addExpense(h.id, {
        category,
        amountCents: amount.cents,
        paidBy: fromShared ? null : paidBy,
        description,
        spentOn: spentOn as IsoDate,
        split,
        receipt,
      })
      navigate(`/households/${h.id}`, {
        replace: true,
        state: { flash: `${description.trim() || SPEND_LABELS[category]}, ${formatCents(amount.cents)}, added.` },
      })
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader back={{ to: `/households/${h.id}`, label: h.name }} title="Add spending" />
      <form onSubmit={handleSubmit} className="space-y-5" noValidate>
        <MoneyField label="How much" value={amountText} onChange={setAmountText} autoFocus />
        <QuickPicks label="What for" options={CATEGORIES} isActive={(c) => c === category} onPick={setCategory} />
        <TextField
          label="Note (optional)"
          maxLength={100}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="e.g. Pak’nSave, Friday sushi"
        />
        <div>
          <p className="mb-1.5 text-sm font-medium">Who paid</p>
          <Segmented label="Who paid" options={payers} value={paidBy} onChange={setPaidBy} />
        </div>

        {fromShared ? (
          <p className="text-sm text-ink-muted">It comes off the shared account. Nobody owes anybody.</p>
        ) : solo ? null : (
          <div className="space-y-3">
            <Segmented
              label="Split"
              options={[
                {
                  value: 'usual',
                  label: h.members.every((m) => m.shareBp !== null) ? 'Household split' : 'Split evenly',
                },
                { value: 'custom', label: 'Custom' },
              ]}
              value={splitMode}
              onChange={setSplitMode}
            />
            {splitMode === 'custom' && (
              <ul className="divide-y divide-line rounded-2xl border border-line">
                {h.members.map((m) => (
                  <li key={m.userId} className="flex items-center gap-2 px-4 py-2">
                    <span className="min-w-0 flex-1 font-medium">{memberName(h, m.userId, me)}</span>
                    <Button
                      variant="ghost"
                      className="min-h-9 px-2 text-xs"
                      onClick={() =>
                        setPercents(
                          Object.fromEntries(h.members.map((x) => [x.userId, x.userId === m.userId ? '100' : '0'])),
                        )
                      }
                    >
                      All<span className="sr-only"> for {memberName(h, m.userId, me)}</span>
                    </Button>
                    <TextField
                      label={`${memberName(h, m.userId, me)} %`}
                      inputMode="decimal"
                      value={percents[m.userId] ?? ''}
                      onChange={(e) => setPercents({ ...percents, [m.userId]: e.target.value })}
                      className="w-20"
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <details className="rounded-3xl border border-line p-5">
          <summary className="cursor-pointer font-semibold">Receipt and date</summary>
          <div className="mt-4 space-y-4">
            <ReceiptField onImage={setReceipt} />
            <TextField
              label="Date"
              type="date"
              max={today}
              value={spentOn}
              onChange={(e) => setSpentOn(e.target.value)}
            />
          </div>
        </details>

        {error && <Notice tone="error">{error}</Notice>}
        <Button type="submit" className="w-full" busy={busy}>
          Add
        </Button>
      </form>
    </div>
  )
}

const monthName = new Intl.DateTimeFormat('en-NZ', { month: 'long', year: 'numeric', timeZone: 'UTC' })
const LABELS: Record<string, string> = { ...CATEGORY_LABELS, ...SPEND_LABELS }

/** /households/:id/month/:month — where the household's money went that month. */
export function MonthPage() {
  const { id = '', month = monthOf(todayInNZ()) } = useParams()
  const { session } = useAuth()
  const me = session?.user.id ?? ''
  const [data] = useAsync(() => getHousehold(id), id)
  if (data.status === 'loading') return <PageSkeleton label="Loading" />
  if (data.status === 'error') return <Notice tone="error">{data.error.message}</Notice>
  const h = data.data

  const input = {
    expenses: h.expenses,
    bills: h.occurrences.map((o) => ({
      category: h.bills.find((b) => b.id === o.billId)?.category ?? 'bills',
      amountCents: o.amountCents,
      dueOn: o.dueOn,
      payerId: o.payerId,
      method: o.method,
      skipped: o.status === 'skipped',
      shares: o.shares,
    })),
    topups: h.sharedEntries.filter((e) => e.kind === 'topup'),
  }
  const now = monthSummary(input, month)
  const before = monthSummary(input, shiftMonth(month, -1))
  const max = Math.max(1, ...now.byCategory.map((c) => c.cents))
  const [y, m] = month.split('-').map(Number) as [number, number]
  const title = monthName.format(new Date(Date.UTC(y, m - 1, 1)))
  const diff = now.totalCents - before.totalCents

  return (
    <div className="space-y-6">
      <PageHeader back={{ to: `/households/${h.id}`, label: h.name }} title={title} />
      <div className="flex justify-between">
        <Link
          to={`/households/${h.id}/month/${shiftMonth(month, -1)}`}
          className="inline-flex min-h-10 items-center gap-1 rounded-full border border-line px-4 text-sm font-semibold"
        >
          <BackIcon className="size-4" />
          Earlier
        </Link>
        {month < monthOf(todayInNZ()) && (
          <Link
            to={`/households/${h.id}/month/${shiftMonth(month, 1)}`}
            className="inline-flex min-h-10 items-center gap-1 rounded-full border border-line px-4 text-sm font-semibold"
          >
            Later
            <ChevronIcon className="size-4" />
          </Link>
        )}
      </div>

      <Card className="space-y-1">
        <p className="text-sm text-ink-muted">Spent in total</p>
        <p className="font-display text-[2.5rem] leading-none font-semibold tabular-nums">
          {formatCents(toCents(now.totalCents))}
        </p>
        {before.totalCents > 0 && (
          <p className="text-sm text-ink-muted">
            {diff === 0
              ? 'Same as the month before'
              : `${formatCents(toCents(Math.abs(diff)))} ${diff > 0 ? 'more' : 'less'} than the month before`}
          </p>
        )}
      </Card>

      {now.byCategory.length === 0 ? (
        <p className="text-sm text-ink-muted">Nothing recorded this month.</p>
      ) : (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">By type</h2>
          <ul className="space-y-3">
            {now.byCategory.map((c) => {
              const prev = before.byCategory.find((x) => x.category === c.category)?.cents ?? 0
              return (
                <li key={c.category}>
                  <div className="flex justify-between gap-3 text-sm">
                    <span className="font-medium">{LABELS[c.category] ?? c.category}</span>
                    <span className="tabular-nums">
                      {formatCents(toCents(c.cents))}
                      {prev > 0 && prev !== c.cents && (
                        <span className="text-ink-muted">
                          {' '}
                          ({c.cents > prev ? '+' : '−'}
                          {formatCents(toCents(Math.abs(c.cents - prev)))})
                        </span>
                      )}
                    </span>
                  </div>
                  <div className="mt-1 h-2.5 rounded-full bg-ring-track" aria-hidden="true">
                    <div className="h-2.5 rounded-full bg-brand" style={{ width: `${(c.cents / max) * 100}%` }} />
                  </div>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {Object.keys(now.paidBy).length > 0 && (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold">Who paid</h2>
          <ul className="divide-y divide-line rounded-3xl border border-line">
            {Object.entries(now.paidBy)
              .sort((a, b) => b[1] - a[1])
              .map(([who, cents]) => (
                <li key={who} className="flex justify-between p-4">
                  <span>{who === 'shared' ? (h.sharedAccountName ?? 'Shared account') : memberName(h, who, me)}</span>
                  <span className="font-semibold tabular-nums">{formatCents(toCents(cents))}</span>
                </li>
              ))}
          </ul>
        </section>
      )}

      {Object.keys(now.toppedUp).length > 0 && (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold">Put into the shared account</h2>
          <ul className="divide-y divide-line rounded-3xl border border-line">
            {Object.entries(now.toppedUp).map(([who, cents]) => (
              <li key={who} className="flex justify-between p-4">
                <span>{memberName(h, who, me)}</span>
                <span className="font-semibold tabular-nums">{formatCents(toCents(cents))}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="text-xs text-ink-muted">Bills count in the month they’re due.</p>
    </div>
  )
}
