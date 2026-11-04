import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { addDays, formatDate, isIsoDate, todayInNZ, type IsoDate } from '../../domain/dates'
import { formatCents, parseDollars, toCents } from '../../domain/money'
import { splitBill, type SplitMode } from '../../domain/split'
import { createSplitBill } from '../../data/bills'
import { listPeople, type Connection } from '../../data/people'
import { Avatar } from '../../shared/Avatar'
import { CheckIcon, PeopleIcon } from '../../shared/icons'
import { useAsync } from '../../shared/useAsync'
import { Card, EmptyState, Notice, PageHeader, PageSkeleton, Segmented, Switch, TextField } from '../../shared/ui'
import { MoneyField, QuickPicks, WizardStep } from '../../shared/Wizard'
import { useAuth } from '../auth/useAuth'
import { ReceiptField } from '../repayments/ReceiptField'

type Step = 'what' | 'receipt' | 'who' | 'split' | 'due' | 'review'
const STEPS: Step[] = ['what', 'receipt', 'who', 'split', 'due', 'review']

const MODES: { value: SplitMode; label: string }[] = [
  { value: 'even', label: 'Evenly' },
  { value: 'percent', label: 'By %' },
  { value: 'amount', label: 'By amount' },
]

/** /bills/new — you paid for something and others owe you their share (ADR-0020). */
export function SplitBillPage() {
  const { session } = useAuth()
  const userId = session?.user.id ?? ''
  const [people] = useAsync(() => listPeople(userId), userId)

  if (people.status === 'loading') return <PageSkeleton label="Loading" />
  if (people.status === 'error') return <Notice tone="error">{people.error.message}</Notice>

  if (people.data.borrowers.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={<PeopleIcon className="size-6" />}
          title="No one to split with yet"
          action={
            <Link to="/people#invite" className="text-sm font-medium text-brand-ink underline">
              Invite someone
            </Link>
          }
        >
          Invite the people you share costs with. Once they join, you can split bills with them.
        </EmptyState>
      </Card>
    )
  }
  return <SplitBillForm people={people.data.borrowers} />
}

function SplitBillForm({ people }: { people: Connection[] }) {
  const navigate = useNavigate()
  const today = todayInNZ()
  const [step, setStep] = useState<Step>('what')
  const [description, setDescription] = useState('')
  const [totalText, setTotalText] = useState('')
  const [receipt, setReceipt] = useState<Blob | null>(null)
  const [paidOn, setPaidOn] = useState<string>(today)
  const [chosen, setChosen] = useState<string[]>(people.length === 1 && people[0] ? [people[0].relationshipId] : [])
  const [includeMe, setIncludeMe] = useState(true)
  const [mode, setMode] = useState<SplitMode>('even')
  const [values, setValues] = useState<Record<string, string>>({})
  const [dueOn, setDueOn] = useState<string>(addDays(today, 7))
  const [errors, setErrors] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  const total = parseDollars(totalText)
  const totalCents = total.ok ? total.cents : toCents(0)
  const split = splitBill({ totalCents, mode, people: chosen, includeMe, values })
  const nameOf = (id: string) => people.find((p) => p.relationshipId === id)?.personName ?? ''
  const firstOf = (id: string) => nameOf(id).split(' ')[0] ?? ''
  const index = STEPS.indexOf(step)
  const position = { step: index + 1, of: STEPS.length }

  function problemsFor(s: Step): string[] {
    switch (s) {
      case 'what':
        return [
          ...(description.trim() ? [] : ['Say what it was for, e.g. Groceries.']),
          ...(total.ok && total.cents > 0 ? [] : ['Enter how much the bill was.']),
        ]
      case 'receipt':
        return [
          ...(receipt ? [] : ['Add a photo of the receipt.']),
          ...(isIsoDate(paidOn) && paidOn <= today ? [] : ['The date paid can’t be in the future.']),
        ]
      case 'who':
        return chosen.length > 0 ? [] : ['Choose who it’s split with.']
      case 'split':
        return split.problems
      case 'due':
        return isIsoDate(dueOn) && dueOn >= today ? [] : ['Pick a date from today on.']
      default:
        return []
    }
  }

  function goNext() {
    const problems = problemsFor(step)
    setErrors(problems)
    if (problems.length === 0) setStep(STEPS[index + 1] ?? step)
  }
  function goBack() {
    setErrors([])
    const previous = STEPS[index - 1]
    if (previous) setStep(previous)
    else navigate(-1)
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (step !== 'review') return goNext()
    setBusy(true)
    setErrors([])
    try {
      await createSplitBill({
        description,
        totalCents,
        paidOn: paidOn as IsoDate,
        dueOn: dueOn as IsoDate,
        shares: chosen.map((id) => ({ relationshipId: id, amountCents: split.shares[id] ?? toCents(0) })),
        receipt,
      })
      navigate('/loans', {
        replace: true,
        state: { flash: `Sent to ${chosen.map(firstOf).join(' and ')} to accept.` },
      })
    } catch (err) {
      setErrors([(err as Error).message])
      setBusy(false)
    }
  }

  const next = { label: 'Continue', submit: true }

  return (
    <div className="space-y-6">
      <PageHeader back={{ to: '/loans', label: 'Owed' }} title="Split a bill" />
      <form onSubmit={handleSubmit} noValidate>
        {step === 'what' && (
          <WizardStep {...position} title="What did you pay for?" errors={errors} onBack={goBack} next={next}>
            <TextField
              label="What it was for"
              maxLength={200}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Groceries"
              autoFocus
            />
            <div>
              <p className="mb-1.5 text-sm font-medium">The whole bill</p>
              <MoneyField label="Bill total" value={totalText} onChange={setTotalText} />
            </div>
          </WizardStep>
        )}

        {step === 'receipt' && (
          <WizardStep
            {...position}
            title="Add the receipt"
            hint="Everyone you split with can see it."
            errors={errors}
            onBack={goBack}
            next={next}
          >
            <ReceiptField onImage={setReceipt} />
            <TextField
              label="Date paid"
              type="date"
              max={today}
              value={paidOn}
              onChange={(e) => setPaidOn(e.target.value)}
            />
          </WizardStep>
        )}

        {step === 'who' && (
          <WizardStep {...position} title="Who’s it split with?" errors={errors} onBack={goBack} next={next}>
            <ul className="space-y-2">
              {people.map((p) => {
                const on = chosen.includes(p.relationshipId)
                return (
                  <li key={p.relationshipId}>
                    <button
                      type="button"
                      aria-pressed={on}
                      onClick={() =>
                        setChosen((c) => (on ? c.filter((id) => id !== p.relationshipId) : [...c, p.relationshipId]))
                      }
                      className={
                        'flex w-full items-center gap-3 rounded-3xl border-2 p-3 pr-4 text-left transition ' +
                        'focus-visible:outline-2 focus-visible:outline-brand-ink ' +
                        (on ? 'border-brand' : 'border-line hover:border-brand-ink')
                      }
                    >
                      <Avatar name={p.personName} photo={p.personPhoto} />
                      <span className="min-w-0 flex-1 font-semibold">{p.personName}</span>
                      <span
                        aria-hidden="true"
                        className={`flex size-7 items-center justify-center rounded-full ${on ? 'bg-brand text-on-brand' : 'border-2 border-line'}`}
                      >
                        {on && <CheckIcon className="size-4" />}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
            <Switch
              label="Include me"
              description="Turn off if none of it was for you."
              checked={includeMe}
              onChange={setIncludeMe}
            />
          </WizardStep>
        )}

        {step === 'split' && (
          <WizardStep
            {...position}
            title="How is it split?"
            hint={`${formatCents(totalCents)} for ${description.trim()}`}
            errors={errors}
            onBack={goBack}
            next={next}
          >
            <Segmented label="Split" options={MODES} value={mode} onChange={setMode} />
            <ul className="divide-y divide-line rounded-2xl border border-line">
              {chosen.map((id) => (
                <li key={id} className="flex items-center gap-3 px-4 py-3">
                  <span className="min-w-0 flex-1 font-medium">{nameOf(id)}</span>
                  {mode === 'even' ? (
                    <span className="font-semibold tabular-nums">{formatCents(split.shares[id] ?? toCents(0))}</span>
                  ) : (
                    <>
                      {mode === 'percent' && (
                        <span className="text-sm text-ink-muted tabular-nums">
                          {formatCents(split.shares[id] ?? toCents(0))}
                        </span>
                      )}
                      <TextField
                        label={mode === 'percent' ? `${firstOf(id)}’s %` : `${firstOf(id)}’s share ($)`}
                        inputMode="decimal"
                        value={values[id] ?? ''}
                        onChange={(e) => setValues((v) => ({ ...v, [id]: e.target.value }))}
                        className="w-28"
                      />
                    </>
                  )}
                </li>
              ))}
              <li className="flex items-center gap-3 px-4 py-3 text-ink-muted">
                <span className="min-w-0 flex-1">{includeMe || mode !== 'even' ? 'Your share' : 'You'}</span>
                <span className="tabular-nums">{formatCents(split.myShareCents)}</span>
              </li>
            </ul>
          </WizardStep>
        )}

        {step === 'due' && (
          <WizardStep {...position} title="When should they pay you back?" errors={errors} onBack={goBack} next={next}>
            <QuickPicks
              label="Quick dates"
              options={[
                { label: 'In 3 days', value: addDays(today, 3) },
                { label: 'In a week', value: addDays(today, 7) },
                { label: 'In 2 weeks', value: addDays(today, 14) },
              ]}
              isActive={(d) => d === dueOn}
              onPick={setDueOn}
            />
            <TextField
              label="Pay back by"
              type="date"
              min={today}
              value={dueOn}
              onChange={(e) => setDueOn(e.target.value)}
            />
          </WizardStep>
        )}

        {step === 'review' && (
          <WizardStep
            {...position}
            title="Check and send"
            hint="Each person accepts their share. You’ll get an alert when they do."
            errors={errors}
            onBack={goBack}
            next={{ label: `Send to ${chosen.map(firstOf).join(' and ')}`, submit: true, busy }}
          >
            <Card className="space-y-3">
              <p>
                <span className="font-semibold">{description.trim()}</span>,{' '}
                <span className="tabular-nums">{formatCents(totalCents)}</span>, paid {formatDate(paidOn as IsoDate)}
              </p>
              <ul className="divide-y divide-line">
                {chosen.map((id) => (
                  <li key={id} className="flex justify-between gap-3 py-2">
                    <span>{nameOf(id)} owes you</span>
                    <span className="font-semibold tabular-nums">{formatCents(split.shares[id] ?? toCents(0))}</span>
                  </li>
                ))}
              </ul>
              <p className="text-sm text-ink-muted">Due {formatDate(dueOn as IsoDate)}. Receipt attached.</p>
            </Card>
          </WizardStep>
        )}
      </form>
    </div>
  )
}
