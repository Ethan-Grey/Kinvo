import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { addDays, formatDate, formatShortDate, isIsoDate, todayInNZ, type IsoDate } from '../../domain/dates'
import { formatCents, formatSignedCents, parseDollars, toCents } from '../../domain/money'
import { nextOnOrAfter, type Frequency, type Plan } from '../../domain/moneyPlan'
import type { PersonalBillCategory, RepeatFrequency } from '../../data/database.types'
import {
  getMyMoney,
  PERSONAL_CATEGORY_LABELS,
  PERSONAL_FREQUENCY_LABELS,
  planFor,
  savePay,
  savePersonalBill,
  setMyBalance,
  stopPersonalBill,
  type MyMoney,
  type PersonalBill,
} from '../../data/myMoney'
import { PlusIcon } from '../../shared/icons'
import { useAsync } from '../../shared/useAsync'
import { Button, Card, Notice, PageHeader, PageSkeleton, Segmented, Select, TextField } from '../../shared/ui'
import { useAuth } from '../auth/useAuth'

/** /money — private: your bills, pay day, and what's safe to spend until then. */
export function MyMoneyPage() {
  const { session } = useAuth()
  const userId = session?.user.id ?? ''
  const [data, reload] = useAsync(() => getMyMoney(userId), userId)
  if (data.status === 'loading') return <PageSkeleton label="Loading" />
  if (data.status === 'error') return <Notice tone="error">{data.error.message}</Notice>
  const m = data.data
  const plan = planFor(m)

  return (
    <div className="space-y-6">
      <PageHeader title="My money" subtitle="Only you can see this." />
      {plan ? <SafeToSpend plan={plan} m={m} onChanged={reload} /> : <PaySetup onDone={reload} />}
      {plan && <PlanList plan={plan} />}
      <Bills bills={m.bills} onChanged={reload} />
      {m.pay && <PaySettings m={m} onDone={reload} />}
    </div>
  )
}

function SafeToSpend({ plan, m, onChanged }: { plan: Plan; m: MyMoney; onChanged: () => void }) {
  const [editing, setEditing] = useState(!m.balance)
  return (
    <Card className="space-y-4">
      <div>
        <p className="text-sm text-ink-muted">Safe to spend until pay day, {formatShortDate(plan.nextPayOn)}</p>
        {plan.safeCents === null ? (
          <p className="mt-1">Enter what’s in your account to see this.</p>
        ) : (
          <>
            <p
              className={`font-display text-[2.75rem] leading-none font-semibold tabular-nums ${plan.safeCents < 0 ? 'text-danger' : ''}`}
            >
              {formatSignedCents(plan.safeCents)}
            </p>
            {plan.perDayCents !== null && plan.safeCents > 0 && (
              <p className="mt-1 text-sm text-ink-muted">
                About {formatCents(toCents(plan.perDayCents))} a day for {plan.daysLeft} day
                {plan.daysLeft === 1 ? '' : 's'}
              </p>
            )}
            {plan.safeCents < 0 && (
              <p className="mt-1 text-sm text-danger">
                What’s due before pay day is more than you have. Move a bill, or talk to who you owe.
              </p>
            )}
          </>
        )}
      </div>
      {m.balance && !editing && (
        <p className="text-sm text-ink-muted">
          From your balance of {formatSignedCents(m.balance.cents)} on {formatShortDate(m.balance.on)}
          {plan.paysSinceCents > 0 && `, plus ${formatCents(toCents(plan.paysSinceCents))} pay since`}
          {plan.totalCommittedCents > 0 && `, less ${formatCents(toCents(plan.totalCommittedCents))} still to come out`}
          .
        </p>
      )}
      {editing ? (
        <BalanceForm
          onDone={() => {
            setEditing(false)
            onChanged()
          }}
        />
      ) : (
        <Button variant="secondary" className="w-full" onClick={() => setEditing(true)}>
          Update my balance
        </Button>
      )}
    </Card>
  )
}

function BalanceForm({ onDone }: { onDone: () => void }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const negative = text.trim().startsWith('-')
    const parsed = parseDollars(text.replace(/^\s*-/, ''))
    if (!parsed.ok) return setError('Enter what your banking app shows, like 812.50.')
    setBusy(true)
    setError(null)
    try {
      await setMyBalance(negative ? -parsed.cents : parsed.cents)
      onDone()
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }
  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <TextField
        label="What’s in your account now ($)"
        inputMode="decimal"
        value={text}
        onChange={(e) => setText(e.target.value)}
        hint="The account your pay goes into. Check your banking app."
      />
      {error && <Notice tone="error">{error}</Notice>}
      <Button type="submit" className="w-full" busy={busy}>
        Save balance
      </Button>
    </form>
  )
}

const PAY_FREQUENCIES: { value: RepeatFrequency; label: string }[] = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'fortnightly', label: 'Fortnightly' },
  { value: 'monthly', label: 'Monthly' },
]

function PayForm({ m, onDone, submitLabel }: { m?: MyMoney; onDone: () => void; submitLabel: string }) {
  const today = todayInNZ()
  const [text, setText] = useState(m?.pay ? String(m.pay.amountCents / 100) : '')
  const [frequency, setFrequency] = useState<RepeatFrequency>(m?.pay?.frequency ?? 'fortnightly')
  const [nextPay, setNextPay] = useState<string>(
    m?.pay ? nextOnOrAfter(m.pay.nextPayOn, m.pay.frequency, addDays(today, 1)) : addDays(today, 7),
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const parsed = parseDollars(text)
    if (!parsed.ok || parsed.cents < 1) return setError('Enter what you take home each pay.')
    if (!isIsoDate(nextPay) || nextPay <= today) return setError('Pick your next pay day (after today).')
    setBusy(true)
    setError(null)
    try {
      await savePay(parsed.cents, frequency, nextPay as IsoDate)
      onDone()
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }
  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <TextField
        label="Take-home pay each time ($)"
        inputMode="decimal"
        value={text}
        onChange={(e) => setText(e.target.value)}
        hint="After tax, what lands in your account."
      />
      <Segmented label="How often you’re paid" options={PAY_FREQUENCIES} value={frequency} onChange={setFrequency} />
      <TextField
        label="Next pay day"
        type="date"
        min={addDays(today, 1)}
        value={nextPay}
        onChange={(e) => setNextPay(e.target.value)}
      />
      {error && <Notice tone="error">{error}</Notice>}
      <Button type="submit" className="w-full" busy={busy}>
        {submitLabel}
      </Button>
    </form>
  )
}

function PaySetup({ onDone }: { onDone: () => void }) {
  return (
    <Card className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">When do you get paid?</h2>
        <p className="text-sm text-ink-muted">
          Kinvo works out what’s safe to spend until your next pay, after your bills, top-ups and loan payments.
        </p>
      </div>
      <PayForm onDone={onDone} submitLabel="Save pay" />
    </Card>
  )
}

function PaySettings({ m, onDone }: { m: MyMoney; onDone: () => void }) {
  return (
    <details className="rounded-3xl border border-line p-5">
      <summary className="cursor-pointer font-semibold">
        Pay: {m.pay && formatCents(toCents(m.pay.amountCents))} {m.pay?.frequency}
      </summary>
      <div className="mt-4">
        <PayForm m={m} onDone={onDone} submitLabel="Save pay" />
      </div>
    </details>
  )
}

function PlanList({ plan }: { plan: Plan }) {
  return (
    <section className="space-y-3" aria-labelledby="coming-out">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="coming-out" className="text-lg font-semibold">
          Coming out before pay day
        </h2>
        <span className="font-semibold tabular-nums">{formatCents(toCents(plan.totalCommittedCents))}</span>
      </div>
      {plan.commitments.length === 0 ? (
        <p className="text-sm text-ink-muted">Nothing due before {formatDate(plan.nextPayOn)}.</p>
      ) : (
        <ul className="divide-y divide-line rounded-3xl border border-line">
          {plan.commitments.map((c, i) => (
            <li key={`${c.label}-${c.dueOn}-${i}`} className="flex items-center gap-3 p-4">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{c.label}</span>
                <span className={`block text-sm ${c.overdue ? 'text-danger' : 'text-ink-muted'}`}>
                  {c.overdue ? `Overdue since ${formatShortDate(c.dueOn)}` : formatShortDate(c.dueOn)}
                </span>
              </span>
              <span className="font-semibold tabular-nums">{formatCents(toCents(c.cents))}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-ink-muted">
        Includes your bills below, your shared-account top-ups, money you owe in{' '}
        <Link to="/loans?show=borrowing" className="underline">
          Owed
        </Link>
        , and household bill shares you pay yourself.
      </p>
    </section>
  )
}

const CATEGORY_OPTIONS = (Object.keys(PERSONAL_CATEGORY_LABELS) as PersonalBillCategory[]).map((value) => ({
  value,
  label: PERSONAL_CATEGORY_LABELS[value],
}))
const FREQUENCY_OPTIONS = (Object.keys(PERSONAL_FREQUENCY_LABELS) as Frequency[]).map((value) => ({
  value,
  label: PERSONAL_FREQUENCY_LABELS[value],
}))

function Bills({ bills, onChanged }: { bills: PersonalBill[]; onChanged: () => void }) {
  const [editing, setEditing] = useState<string | 'new' | null>(null)
  const today = todayInNZ()
  return (
    <section className="space-y-3" aria-labelledby="my-bills">
      <h2 id="my-bills" className="text-lg font-semibold">
        My bills
      </h2>
      {bills.length > 0 && (
        <ul className="divide-y divide-line rounded-3xl border border-line">
          {bills.map((b) =>
            editing === b.id ? (
              <li key={b.id} className="p-4">
                <BillForm
                  bill={b}
                  onDone={() => {
                    setEditing(null)
                    onChanged()
                  }}
                  onCancel={() => setEditing(null)}
                />
              </li>
            ) : (
              <li key={b.id}>
                <button
                  type="button"
                  onClick={() => setEditing(b.id)}
                  className="flex w-full items-center gap-3 p-4 text-left focus-visible:outline-2 focus-visible:outline-brand-ink"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{b.name}</span>
                    <span className="block text-sm text-ink-muted">
                      {PERSONAL_FREQUENCY_LABELS[b.frequency]}, next{' '}
                      {formatShortDate(nextOnOrAfter(b.firstDueOn, b.frequency, today))}
                    </span>
                  </span>
                  <span className="font-semibold tabular-nums">
                    {b.amountType === 'varies' ? 'about ' : ''}
                    {formatCents(b.amountCents)}
                  </span>
                </button>
              </li>
            ),
          )}
        </ul>
      )}
      {editing === 'new' ? (
        <Card>
          <BillForm
            onDone={() => {
              setEditing(null)
              onChanged()
            }}
            onCancel={() => setEditing(null)}
          />
        </Card>
      ) : (
        <Button variant="secondary" className="w-full" onClick={() => setEditing('new')}>
          <PlusIcon className="size-5" />
          Add a bill
        </Button>
      )}
    </section>
  )
}

function BillForm({ bill, onDone, onCancel }: { bill?: PersonalBill; onDone: () => void; onCancel: () => void }) {
  const today = todayInNZ()
  const [name, setName] = useState(bill?.name ?? '')
  const [category, setCategory] = useState<PersonalBillCategory>(bill?.category ?? 'phone')
  const [amountType, setAmountType] = useState<'fixed' | 'varies'>(bill?.amountType ?? 'fixed')
  const [text, setText] = useState(bill ? String(bill.amountCents / 100) : '')
  const [frequency, setFrequency] = useState<Frequency>(bill?.frequency ?? 'monthly')
  const [due, setDue] = useState<string>(
    bill ? nextOnOrAfter(bill.firstDueOn, bill.frequency, today) : addDays(today, 7),
  )
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const parsed = parseDollars(text)
    if (!name.trim()) return setError('Give the bill a name, e.g. Phone.')
    if (!parsed.ok || parsed.cents < 1)
      return setError(amountType === 'fixed' ? 'Enter the amount.' : 'Enter a rough guess.')
    if (!isIsoDate(due)) return setError('Pick when it’s next due.')
    setBusy('save')
    setError(null)
    try {
      await savePersonalBill(bill?.id ?? null, {
        name,
        category,
        amountType,
        amountCents: parsed.cents,
        frequency,
        firstDueOn: due as IsoDate,
      })
      onDone()
    } catch (err) {
      setError((err as Error).message)
      setBusy(null)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <TextField
        label="Name"
        maxLength={60}
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="e.g. Phone, Car insurance"
      />
      <Select
        label="Type"
        options={CATEGORY_OPTIONS}
        value={category}
        onChange={(e) => setCategory(e.target.value as PersonalBillCategory)}
      />
      <Segmented
        label="Amount"
        options={[
          { value: 'fixed', label: 'Same each time' },
          { value: 'varies', label: 'Changes' },
        ]}
        value={amountType}
        onChange={setAmountType}
      />
      <TextField
        label={amountType === 'fixed' ? 'Amount ($)' : 'Rough amount ($)'}
        inputMode="decimal"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <Select
        label="How often"
        options={FREQUENCY_OPTIONS}
        value={frequency}
        onChange={(e) => setFrequency(e.target.value as Frequency)}
      />
      <TextField label="Next due" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
      {error && <Notice tone="error">{error}</Notice>}
      <div className="flex gap-2">
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" className="flex-1" busy={busy === 'save'}>
          {bill ? 'Save' : 'Add bill'}
        </Button>
      </div>
      {bill && (
        <Button
          variant="ghost"
          className="w-full"
          busy={busy === 'stop'}
          onClick={async () => {
            if (!window.confirm(`Remove ${bill.name}?`)) return
            setBusy('stop')
            try {
              await stopPersonalBill(bill.id)
              onDone()
            } catch (err) {
              setError((err as Error).message)
              setBusy(null)
            }
          }}
        >
          Remove this bill
        </Button>
      )}
    </form>
  )
}
