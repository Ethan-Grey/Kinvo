import { useState, type FormEvent, type ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router'
import { addDays, formatDate, isIsoDate, todayInNZ, type IsoDate } from '../../domain/dates'
import { equalShares } from '../../domain/household'
import { formatCents, parseDollars } from '../../domain/money'
import type { BillCategory, BillMethod, RepeatFrequency } from '../../data/database.types'
import {
  CATEGORY_LABELS,
  changeBill,
  changeOccurrencePayment,
  createBill,
  enterBillAmount,
  getHousehold,
  memberName,
  METHOD_LABELS,
  skipOccurrence,
  stopBill,
  uploadHouseholdReceipt,
  type Bill,
  type BillOccurrence,
  type HouseholdDetail,
} from '../../data/households'
import { FREQUENCY_LABELS } from '../../data/repeating'
import { useAsync } from '../../shared/useAsync'
import { Badge, Button, Card, Notice, PageHeader, PageSkeleton, Segmented, Select, TextField } from '../../shared/ui'
import { MoneyField, WizardStep } from '../../shared/Wizard'
import { useAuth } from '../auth/useAuth'
import { ReceiptField } from '../repayments/ReceiptField'

/** Loads the household for a bill page. */
function WithHousehold({ children }: { children: (h: HouseholdDetail, me: string, reload: () => void) => ReactNode }) {
  const { id = '' } = useParams()
  const { session } = useAuth()
  const me = session?.user.id ?? ''
  const [data, reload] = useAsync(() => getHousehold(id), id)
  if (data.status === 'loading') return <PageSkeleton label="Loading" />
  if (data.status === 'error') return <Notice tone="error">{data.error.message}</Notice>
  return <>{children(data.data, me, reload)}</>
}

const CATEGORY_OPTIONS = (Object.keys(CATEGORY_LABELS) as BillCategory[]).map((value) => ({
  value,
  label: CATEGORY_LABELS[value],
}))
const FREQUENCY_OPTIONS = (Object.keys(FREQUENCY_LABELS) as RepeatFrequency[]).map((value) => ({
  value,
  label: FREQUENCY_LABELS[value],
}))

type SplitChoice = 'default' | 'custom'

/** Who pays, and how it's split, for a new or changed bill. */
function PaymentChoice({
  h,
  me,
  method,
  setMethod,
  payerId,
  setPayerId,
}: {
  h: HouseholdDetail
  me: string
  method: BillMethod
  setMethod: (m: BillMethod) => void
  payerId: string | null
  setPayerId: (id: string) => void
}) {
  const methods = (Object.keys(METHOD_LABELS) as BillMethod[]).filter(
    (m) => m !== 'shared_account' || h.hasSharedAccount,
  )
  return (
    <div className="space-y-3">
      <div role="radiogroup" aria-label="How it’s paid" className="space-y-2">
        {methods.map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={method === m}
            onClick={() => setMethod(m)}
            className={
              'w-full rounded-2xl border-2 p-4 text-left transition focus-visible:outline-2 focus-visible:outline-brand-ink ' +
              (method === m ? 'border-brand' : 'border-line hover:border-brand-ink')
            }
          >
            <span className="block font-semibold">{METHOD_LABELS[m]}</span>
            <span className="block text-sm text-ink-muted">
              {m === 'shared_account'
                ? 'It comes out of the shared account. Nobody owes anybody.'
                : m === 'one_person'
                  ? 'They pay it; everyone else’s share goes on the tab.'
                  : m === 'each_own'
                    ? 'Each person pays their part directly and ticks it off.'
                    : 'Just tracked. Nobody pays them back.'}
            </span>
          </button>
        ))}
      </div>
      {(method === 'one_person' || method === 'covered') && (
        <Select
          label="Who pays it"
          options={h.members.map((m) => ({ value: m.userId, label: memberName(h, m.userId, me) }))}
          value={payerId ?? ''}
          onChange={(e) => setPayerId(e.target.value)}
        />
      )}
    </div>
  )
}

function SplitEditor({
  h,
  me,
  choice,
  setChoice,
  percents,
  setPercents,
}: {
  h: HouseholdDetail
  me: string
  choice: SplitChoice
  setChoice: (c: SplitChoice) => void
  percents: Record<string, string>
  setPercents: (p: Record<string, string>) => void
}) {
  const custom = h.members.some((m) => m.shareBp !== null)
  return (
    <div className="space-y-3">
      <Segmented
        label="Split"
        options={[
          { value: 'default', label: custom ? 'Household split' : 'Evenly' },
          { value: 'custom', label: 'Custom %' },
        ]}
        value={choice}
        onChange={setChoice}
      />
      {choice === 'custom' && (
        <ul className="divide-y divide-line rounded-2xl border border-line">
          {h.members.map((m) => (
            <li key={m.userId} className="flex items-center gap-3 px-4 py-2">
              <span className="min-w-0 flex-1 font-medium">{memberName(h, m.userId, me)}</span>
              <TextField
                label={`${memberName(h, m.userId, me)} %`}
                inputMode="decimal"
                value={percents[m.userId] ?? ''}
                onChange={(e) => setPercents({ ...percents, [m.userId]: e.target.value })}
                className="w-24"
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Turns typed percentages into shares, or a problem. */
function sharesFrom(h: HouseholdDetail, percents: Record<string, string>) {
  const shares = h.members.map((m) => ({
    userId: m.userId,
    shareBp: Math.round(Number(percents[m.userId] || 0) * 100),
  }))
  if (shares.some((s) => !Number.isFinite(s.shareBp) || s.shareBp < 0))
    return { problem: 'Enter a percentage for each person.' }
  if (shares.reduce((sum, s) => sum + s.shareBp, 0) !== 10000) return { problem: 'The percentages must add up to 100.' }
  return { shares }
}

function startingPercents(h: HouseholdDetail, split: Bill['split']): Record<string, string> {
  const source =
    split ??
    (h.members.every((m) => m.shareBp !== null)
      ? h.members.map((m) => ({ userId: m.userId, shareBp: m.shareBp ?? 0 }))
      : equalShares(h.members.map((m) => m.userId)))
  return Object.fromEntries(source.map((s) => [s.userId, String(s.shareBp / 100)]))
}

type Step = 'what' | 'amount' | 'when' | 'who' | 'split' | 'review'

/** /households/:id/bills/new */
export function NewBillPage() {
  return <WithHousehold>{(h, me) => <NewBillForm h={h} me={me} />}</WithHousehold>
}

function NewBillForm({ h, me }: { h: HouseholdDetail; me: string }) {
  const navigate = useNavigate()
  const today = todayInNZ()
  const [step, setStep] = useState<Step>('what')
  const [name, setName] = useState('')
  const [category, setCategory] = useState<BillCategory>('rent')
  const [amountType, setAmountType] = useState<'fixed' | 'varies'>('fixed')
  const [amountText, setAmountText] = useState('')
  const [frequency, setFrequency] = useState<RepeatFrequency>('weekly')
  const [firstDue, setFirstDue] = useState<string>(addDays(today, 1))
  const [method, setMethod] = useState<BillMethod>(h.hasSharedAccount ? 'shared_account' : 'one_person')
  const [payerId, setPayerId] = useState<string | null>(me)
  const [choice, setChoice] = useState<SplitChoice>('default')
  const [percents, setPercents] = useState(() => startingPercents(h, null))
  const [errors, setErrors] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  const needsSplit = method === 'one_person' || method === 'each_own'
  const steps: Step[] = [
    'what',
    'amount',
    'when',
    'who',
    ...(needsSplit && h.members.length > 1 ? (['split'] as Step[]) : []),
    'review',
  ]
  const index = steps.indexOf(step)
  const amount = parseDollars(amountText)

  function problems(): string[] {
    if (step === 'what') return name.trim() ? [] : ['Give the bill a name, e.g. Rent.']
    if (step === 'amount') {
      if (amountType === 'fixed') return amount.ok && amount.cents > 0 ? [] : ['Enter the amount each time.']
      return !amountText.trim() || (amount.ok && amount.cents > 0)
        ? []
        : ['Enter a rough guess like 180, or leave it blank.']
    }
    if (step === 'when') return isIsoDate(firstDue) ? [] : ['Pick the next due date.']
    if (step === 'split' && choice === 'custom') {
      const r = sharesFrom(h, percents)
      return 'problem' in r && r.problem ? [r.problem] : []
    }
    return []
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (step !== 'review') {
      const p = problems()
      setErrors(p)
      if (p.length === 0) setStep(steps[index + 1] ?? step)
      return
    }
    setBusy(true)
    setErrors([])
    try {
      const r = choice === 'custom' && needsSplit ? sharesFrom(h, percents) : null
      const billId = await createBill(h.id, {
        name,
        category,
        amountType,
        amountCents: amount.ok && amount.cents > 0 ? amount.cents : null,
        frequency,
        firstDueOn: firstDue as IsoDate,
        method,
        payerId: method === 'one_person' || method === 'covered' ? payerId : null,
        split: r && 'shares' in r && r.shares ? r.shares : null,
      })
      navigate(`/households/${h.id}/bills/${billId}`, { replace: true, state: { flash: 'Bill added.' } })
    } catch (err) {
      setErrors([(err as Error).message])
      setBusy(false)
    }
  }

  const back = () => {
    setErrors([])
    const previous = steps[index - 1]
    if (previous) setStep(previous)
    else navigate(`/households/${h.id}`)
  }
  const position = { step: index + 1, of: steps.length }
  const next = { label: 'Continue', submit: true }

  return (
    <div className="space-y-6">
      <PageHeader back={{ to: `/households/${h.id}`, label: h.name }} title="Add a bill" />
      <form onSubmit={handleSubmit} noValidate>
        {step === 'what' && (
          <WizardStep {...position} title="What’s the bill?" errors={errors} onBack={back} next={next}>
            <TextField
              label="Name"
              maxLength={60}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Rent, Power"
              autoFocus
            />
            <Select
              label="Type"
              options={CATEGORY_OPTIONS}
              value={category}
              onChange={(e) => setCategory(e.target.value as BillCategory)}
            />
          </WizardStep>
        )}
        {step === 'amount' && (
          <WizardStep {...position} title="How much is it?" errors={errors} onBack={back} next={next}>
            <Segmented
              label="Amount"
              options={[
                { value: 'fixed', label: 'Same each time' },
                { value: 'varies', label: 'Changes each time' },
              ]}
              value={amountType}
              onChange={setAmountType}
            />
            <div>
              {amountType === 'varies' && (
                <p className="mb-1.5 text-sm text-ink-muted">
                  A rough guess helps the balance forecast. You’ll be asked for the real amount each time.
                </p>
              )}
              <MoneyField
                label={amountType === 'fixed' ? 'Amount each time' : 'Rough guess'}
                value={amountText}
                onChange={setAmountText}
              />
            </div>
          </WizardStep>
        )}
        {step === 'when' && (
          <WizardStep
            {...position}
            title="How often, and when’s the next one?"
            errors={errors}
            onBack={back}
            next={next}
          >
            <Segmented label="How often" options={FREQUENCY_OPTIONS} value={frequency} onChange={setFrequency} />
            <TextField label="Next due" type="date" value={firstDue} onChange={(e) => setFirstDue(e.target.value)} />
          </WizardStep>
        )}
        {step === 'who' && (
          <WizardStep {...position} title="How is it paid?" errors={errors} onBack={back} next={next}>
            <PaymentChoice
              h={h}
              me={me}
              method={method}
              setMethod={setMethod}
              payerId={payerId}
              setPayerId={setPayerId}
            />
          </WizardStep>
        )}
        {step === 'split' && (
          <WizardStep {...position} title="How is it split?" errors={errors} onBack={back} next={next}>
            <SplitEditor
              h={h}
              me={me}
              choice={choice}
              setChoice={setChoice}
              percents={percents}
              setPercents={setPercents}
            />
          </WizardStep>
        )}
        {step === 'review' && (
          <WizardStep
            {...position}
            title="Check and save"
            errors={errors}
            onBack={back}
            next={{ label: 'Save bill', submit: true, busy }}
          >
            <Card className="space-y-1">
              <p className="font-semibold">{name.trim()}</p>
              <p className="font-display text-3xl font-semibold tabular-nums">
                {amount.ok && amount.cents > 0 ? formatCents(amount.cents) : 'Changes'}
                {amountType === 'varies' && amount.ok && amount.cents > 0 && (
                  <span className="text-base text-ink-muted"> (guess)</span>
                )}
              </p>
              <p className="text-ink-muted">
                {FREQUENCY_LABELS[frequency]}, next {formatDate(firstDue as IsoDate)}
              </p>
              <p>
                {METHOD_LABELS[method]}
                {(method === 'one_person' || method === 'covered') && `: ${memberName(h, payerId, me)}`}
              </p>
            </Card>
          </WizardStep>
        )}
      </form>
    </div>
  )
}

/** /households/:id/bills/:billId — one bill: details, what's coming up, history. */
export function BillPage() {
  const { billId = '' } = useParams()
  return (
    <WithHousehold>
      {(h, me, reload) => {
        const bill = h.bills.find((b) => b.id === billId)
        const occurrences = h.occurrences.filter((o) => o.billId === billId)
        if (!bill) {
          return (
            <div className="space-y-4">
              <PageHeader back={{ to: `/households/${h.id}`, label: h.name }} title="Bill" />
              <Notice>This bill has been stopped.</Notice>
              <History h={h} me={me} occurrences={occurrences} />
            </div>
          )
        }
        return <BillDetail h={h} me={me} bill={bill} occurrences={occurrences} onChanged={reload} />
      }}
    </WithHousehold>
  )
}

function BillDetail({
  h,
  me,
  bill,
  occurrences,
  onChanged,
}: {
  h: HouseholdDetail
  me: string
  bill: Bill
  occurrences: BillOccurrence[]
  onChanged: () => void
}) {
  const navigate = useNavigate()
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  return (
    <div className="space-y-5">
      <PageHeader
        back={{ to: `/households/${h.id}`, label: h.name }}
        title={bill.name}
        subtitle={CATEGORY_LABELS[bill.category]}
      />
      <Card className="space-y-1">
        <p className="font-display text-[2.25rem] leading-none font-semibold tabular-nums">
          {bill.amountType === 'fixed' && bill.amountCents !== null
            ? formatCents(bill.amountCents)
            : 'Changes each time'}
        </p>
        <p className="text-ink-muted">
          {FREQUENCY_LABELS[bill.frequency]}
          {bill.nextDueOn && `, next added for ${formatDate(bill.nextDueOn)}`}
        </p>
        <p>
          {METHOD_LABELS[bill.method]}
          {(bill.method === 'one_person' || bill.method === 'covered') && `: ${memberName(h, bill.payerId, me)}`}
        </p>
      </Card>
      {editing ? (
        <EditBill
          h={h}
          me={me}
          bill={bill}
          onDone={() => {
            setEditing(false)
            onChanged()
          }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <Button variant="secondary" className="w-full" onClick={() => setEditing(true)}>
          Change this bill
        </Button>
      )}
      <History h={h} me={me} occurrences={occurrences} />
      {error && <Notice tone="error">{error}</Notice>}
      <Button
        variant="ghost"
        className="w-full"
        onClick={async () => {
          if (!window.confirm(`Stop ${bill.name}? Upcoming ones are removed; past ones stay.`)) return
          try {
            await stopBill(bill.id)
            navigate(`/households/${h.id}`, { replace: true, state: { flash: `${bill.name} stopped.` } })
          } catch (err) {
            setError((err as Error).message)
          }
        }}
      >
        Stop this bill
      </Button>
    </div>
  )
}

function EditBill({
  h,
  me,
  bill,
  onDone,
  onCancel,
}: {
  h: HouseholdDetail
  me: string
  bill: Bill
  onDone: () => void
  onCancel: () => void
}) {
  const [name, setName] = useState(bill.name)
  const [amountType, setAmountType] = useState(bill.amountType)
  const [amountText, setAmountText] = useState(bill.amountCents === null ? '' : String(bill.amountCents / 100))
  const [method, setMethod] = useState<BillMethod>(bill.method)
  const [payerId, setPayerId] = useState<string | null>(bill.payerId ?? me)
  const [choice, setChoice] = useState<SplitChoice>(bill.split ? 'custom' : 'default')
  const [percents, setPercents] = useState(() => startingPercents(h, bill.split))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const amount = parseDollars(amountText)
    if (amountType === 'fixed' && !(amount.ok && amount.cents > 0)) return setError('Enter the amount each time.')
    const needsSplit = method === 'one_person' || method === 'each_own'
    const r = needsSplit && choice === 'custom' ? sharesFrom(h, percents) : null
    if (r && 'problem' in r && r.problem) return setError(r.problem)
    setBusy(true)
    setError(null)
    try {
      await changeBill(bill.id, {
        name,
        category: bill.category,
        amountType,
        amountCents: amount.ok && amount.cents > 0 ? amount.cents : null,
        method,
        payerId: method === 'one_person' || method === 'covered' ? payerId : null,
        split: r && 'shares' in r && r.shares ? r.shares : null,
      })
      onDone()
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  return (
    <Card>
      <form onSubmit={handleSubmit} className="space-y-4">
        <p className="text-sm text-ink-muted">Changes apply from the next one. Ones already listed stay as they are.</p>
        <TextField label="Name" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
        <Segmented
          label="Amount"
          options={[
            { value: 'fixed', label: 'Same each time' },
            { value: 'varies', label: 'Changes each time' },
          ]}
          value={amountType}
          onChange={setAmountType}
        />
        <TextField
          label={amountType === 'fixed' ? 'Amount ($)' : 'Rough guess ($, optional)'}
          inputMode="decimal"
          value={amountText}
          onChange={(e) => setAmountText(e.target.value)}
        />
        <PaymentChoice h={h} me={me} method={method} setMethod={setMethod} payerId={payerId} setPayerId={setPayerId} />
        {(method === 'one_person' || method === 'each_own') && h.members.length > 1 && (
          <SplitEditor
            h={h}
            me={me}
            choice={choice}
            setChoice={setChoice}
            percents={percents}
            setPercents={setPercents}
          />
        )}
        {error && <Notice tone="error">{error}</Notice>}
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" className="flex-1" busy={busy}>
            Save changes
          </Button>
        </div>
      </form>
    </Card>
  )
}

function statusBadge(o: BillOccurrence) {
  if (o.status === 'skipped') return <Badge>Skipped</Badge>
  if (o.status === 'needs_amount') return <Badge tone="warning">Amount needed</Badge>
  if (o.status === 'done') return <Badge tone="positive">Done</Badge>
  return <Badge>Coming up</Badge>
}

function History({ h, me, occurrences }: { h: HouseholdDetail; me: string; occurrences: BillOccurrence[] }) {
  const navigate = useNavigate()
  if (occurrences.length === 0) return null
  return (
    <section className="space-y-2">
      <h2 className="text-lg font-semibold">Each time</h2>
      <ul className="divide-y divide-line rounded-3xl border border-line">
        {occurrences.map((o) => (
          <li key={o.id}>
            <button
              type="button"
              onClick={() => navigate(`/households/${h.id}/bills/due/${o.id}`)}
              className="flex w-full items-center gap-3 p-4 text-left focus-visible:outline-2 focus-visible:outline-brand-ink"
            >
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{formatDate(o.dueOn)}</span>
                <span className="block text-sm text-ink-muted">
                  {o.method === 'shared_account'
                    ? 'Shared account'
                    : o.method === 'each_own'
                      ? `${o.shares.filter((s) => s.paid).length} of ${o.shares.length} paid their share`
                      : `Paid by ${memberName(h, o.payerId, me)}`}
                </span>
              </span>
              <span className="flex flex-col items-end gap-1">
                <span className="font-semibold tabular-nums">
                  {o.amountCents === null ? '—' : formatCents(o.amountCents)}
                </span>
                {statusBadge(o)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** /households/:id/bills/due/:occurrenceId — enter the amount, change how it was paid this time, or skip it. */
export function BillDuePage() {
  const { occurrenceId = '' } = useParams()
  return (
    <WithHousehold>
      {(h, me, reload) => {
        const o = h.occurrences.find((x) => x.id === occurrenceId)
        if (!o) return <Notice tone="error">That bill isn’t here any more.</Notice>
        const bill = h.bills.find((b) => b.id === o.billId)
        return <BillDue h={h} me={me} o={o} billName={bill?.name ?? 'Bill'} onChanged={reload} />
      }}
    </WithHousehold>
  )
}

function BillDue({
  h,
  me,
  o,
  billName,
  onChanged,
}: {
  h: HouseholdDetail
  me: string
  o: BillOccurrence
  billName: string
  onChanged: () => void
}) {
  const navigate = useNavigate()
  const [amountText, setAmountText] = useState(o.amountCents === null ? '' : String(o.amountCents / 100))
  const [receipt, setReceipt] = useState<Blob | null>(null)
  const [method, setMethod] = useState<BillMethod>(o.method)
  const [payerId, setPayerId] = useState<string | null>(o.payerId ?? me)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const back = `/households/${h.id}`

  async function run(key: string, action: () => Promise<unknown>, flash: string) {
    setBusy(key)
    setError(null)
    try {
      await action()
      onChanged()
      navigate(back, { replace: true, state: { flash } })
    } catch (err) {
      setError((err as Error).message)
      setBusy(null)
    }
  }

  async function saveAmount(event: FormEvent) {
    event.preventDefault()
    const amount = parseDollars(amountText)
    if (!amount.ok || amount.cents < 1) return setError('Enter the amount on the bill.')
    await run(
      'amount',
      async () => {
        const path = receipt ? await uploadHouseholdReceipt(h.id, receipt) : null
        await enterBillAmount(o.id, amount.cents, path)
      },
      `${billName}: ${formatCents(amount.cents)} saved.`,
    )
  }

  const canChange = o.status !== 'skipped' && !o.shares.some((s) => s.paid)

  return (
    <div className="space-y-6">
      <PageHeader back={{ to: back, label: h.name }} title={billName} subtitle={`Due ${formatDate(o.dueOn)}`} />
      {error && <Notice tone="error">{error}</Notice>}
      {o.status === 'skipped' ? (
        <Notice>This one was skipped.</Notice>
      ) : (
        <>
          <Card>
            <form onSubmit={saveAmount} className="space-y-4">
              <h2 className="font-semibold">{o.amountCents === null ? 'What was it this time?' : 'The amount'}</h2>
              <MoneyField label="Amount on the bill" value={amountText} onChange={setAmountText} />
              <div>
                <p className="mb-1.5 text-sm font-medium">Bill photo (optional)</p>
                <ReceiptField onImage={setReceipt} />
              </div>
              <Button
                type="submit"
                className="w-full"
                busy={busy === 'amount'}
                disabled={!canChange && o.amountCents !== null}
              >
                Save amount
              </Button>
            </form>
          </Card>

          {canChange && (
            <details className="space-y-4 rounded-3xl border border-line bg-surface p-5">
              <summary className="cursor-pointer font-display font-semibold">Paid differently this time?</summary>
              <p className="mt-3 text-sm text-ink-muted">
                For example, if you covered the rent from your own account this week.
              </p>
              <PaymentChoice
                h={h}
                me={me}
                method={method}
                setMethod={setMethod}
                payerId={payerId}
                setPayerId={setPayerId}
              />
              <Button
                variant="secondary"
                className="w-full"
                busy={busy === 'method'}
                disabled={method === o.method && (payerId ?? null) === (o.payerId ?? payerId)}
                onClick={() =>
                  run(
                    'method',
                    () =>
                      changeOccurrencePayment(
                        o.id,
                        method,
                        method === 'one_person' || method === 'covered' ? payerId : null,
                      ),
                    'Updated for this time.',
                  )
                }
              >
                Save for this time only
              </Button>
            </details>
          )}

          {o.shares.length > 0 && (
            <Card className="space-y-2">
              <h2 className="font-semibold">Each person’s share</h2>
              <ul className="divide-y divide-line">
                {o.shares.map((s) => (
                  <li key={s.userId} className="flex justify-between py-2">
                    <span>{memberName(h, s.userId, me)}</span>
                    <span className="tabular-nums">
                      {formatCents(s.amountCents)} {s.paid ? '· paid' : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Button
            variant="ghost"
            className="w-full"
            busy={busy === 'skip'}
            onClick={() => {
              if (window.confirm(`Skip ${billName} on ${formatDate(o.dueOn)}? Anything it added is undone.`)) {
                void run('skip', () => skipOccurrence(o.id), 'Skipped.')
              }
            }}
          >
            Skip this one
          </Button>
        </>
      )}
    </div>
  )
}
