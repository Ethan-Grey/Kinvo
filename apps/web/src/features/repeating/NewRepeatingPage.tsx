import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { addDays, formatDate, isIsoDate, todayInNZ, type IsoDate } from '../../domain/dates'
import { formatCents, parseDollars, toCents } from '../../domain/money'
import type { RepeatFrequency } from '../../data/database.types'
import { listPeople, type Connection } from '../../data/people'
import { FREQUENCY_LABELS, proposeRepeating } from '../../data/repeating'
import { Avatar } from '../../shared/Avatar'
import { ChevronIcon, PeopleIcon } from '../../shared/icons'
import { useAsync } from '../../shared/useAsync'
import { Card, EmptyState, Notice, PageHeader, PageSkeleton, Segmented, Switch, TextField } from '../../shared/ui'
import { MoneyField, WizardStep } from '../../shared/Wizard'
import { useAuth } from '../auth/useAuth'

type Step = 'what' | 'when' | 'end' | 'review'
const STEPS: Step[] = ['what', 'when', 'end', 'review']

const FREQUENCIES = (Object.keys(FREQUENCY_LABELS) as RepeatFrequency[]).map((value) => ({
  value,
  label: FREQUENCY_LABELS[value],
}))

/** /repeating/new?with=<relationship> — e.g. a share of the rent, agreed once (ADR-0020). */
export function NewRepeatingPage() {
  const { session } = useAuth()
  const userId = session?.user.id ?? ''
  const [params] = useSearchParams()
  const [people] = useAsync(() => listPeople(userId), userId)
  const [chosen, setChosen] = useState<string | null>(params.get('with'))

  if (people.status === 'loading') return <PageSkeleton label="Loading" />
  if (people.status === 'error') return <Notice tone="error">{people.error.message}</Notice>

  const pool = people.data.borrowers
  if (pool.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={<PeopleIcon className="size-6" />}
          title="No one connected yet"
          action={
            <Link to="/people#invite" className="text-sm font-medium text-brand-ink underline">
              Invite someone
            </Link>
          }
        >
          Invite the person who’ll owe you first.
        </EmptyState>
      </Card>
    )
  }

  const selected = pool.find((p) => p.relationshipId === chosen) ?? (pool.length === 1 ? pool[0] : undefined)
  if (!selected) {
    return (
      <div className="space-y-6">
        <PageHeader back={{ to: '/loans', label: 'Owed' }} title="Who’ll owe you?" />
        <ul className="space-y-2">
          {pool.map((p) => (
            <li key={p.relationshipId}>
              <button
                type="button"
                onClick={() => setChosen(p.relationshipId)}
                className="flex w-full items-center gap-3 rounded-3xl border border-line p-3 pr-4 text-left transition hover:border-brand-ink focus-visible:outline-2 focus-visible:outline-brand-ink"
              >
                <Avatar name={p.personName} photo={p.personPhoto} size="lg" />
                <span className="min-w-0 flex-1 font-display text-lg font-semibold">{p.personName}</span>
                <ChevronIcon className="size-5 text-ink-muted" />
              </button>
            </li>
          ))}
        </ul>
      </div>
    )
  }
  return (
    <RepeatingForm
      key={selected.relationshipId}
      person={selected}
      onChangePerson={pool.length > 1 && !params.get('with') ? () => setChosen(null) : undefined}
    />
  )
}

function RepeatingForm({ person, onChangePerson }: { person: Connection; onChangePerson?: () => void }) {
  const navigate = useNavigate()
  const today = todayInNZ()
  const first = person.personName.split(' ')[0] ?? person.personName
  const [step, setStep] = useState<Step>('what')
  const [description, setDescription] = useState('')
  const [amountText, setAmountText] = useState('')
  const [frequency, setFrequency] = useState<RepeatFrequency>('weekly')
  const [firstOn, setFirstOn] = useState<string>(addDays(today, 1))
  const [ends, setEnds] = useState(false)
  const [endOn, setEndOn] = useState<string>(addDays(today, 90))
  const [errors, setErrors] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  const amount = parseDollars(amountText)
  const amountCents = amount.ok ? amount.cents : toCents(0)
  const index = STEPS.indexOf(step)
  const position = { step: index + 1, of: STEPS.length }

  function problemsFor(s: Step): string[] {
    if (s === 'what')
      return [
        ...(description.trim() ? [] : ['Say what it’s for, e.g. Rent.']),
        ...(amount.ok && amount.cents > 0 ? [] : ['Enter the amount each time.']),
      ]
    if (s === 'when') return isIsoDate(firstOn) && firstOn >= today ? [] : ['The first one can’t be in the past.']
    if (s === 'end') return !ends || (isIsoDate(endOn) && endOn >= firstOn) ? [] : ['The end must be after the start.']
    return []
  }

  function goBack() {
    setErrors([])
    const previous = STEPS[index - 1]
    if (previous) setStep(previous)
    else if (onChangePerson) onChangePerson()
    else navigate(-1)
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (step !== 'review') {
      const problems = problemsFor(step)
      setErrors(problems)
      if (problems.length === 0) setStep(STEPS[index + 1] ?? step)
      return
    }
    setBusy(true)
    setErrors([])
    try {
      const id = await proposeRepeating({
        relationshipId: person.relationshipId,
        description,
        amountCents,
        frequency,
        firstOn: firstOn as IsoDate,
        endOn: ends ? (endOn as IsoDate) : null,
      })
      navigate(`/repeating/${id}`, { replace: true, state: { flash: `Sent to ${first} to accept.` } })
    } catch (err) {
      setErrors([(err as Error).message])
      setBusy(false)
    }
  }

  const next = { label: 'Continue', submit: true }

  return (
    <div className="space-y-6">
      <PageHeader back={{ to: '/loans', label: 'Owed' }} title={`Repeating, with ${first}`} />
      <form onSubmit={handleSubmit} noValidate>
        {step === 'what' && (
          <WizardStep
            {...position}
            title="What’s it for, and how much each time?"
            errors={errors}
            onBack={goBack}
            next={next}
          >
            <TextField
              label="What it’s for"
              maxLength={200}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Rent"
              autoFocus
            />
            <MoneyField label="Amount each time" value={amountText} onChange={setAmountText} />
          </WizardStep>
        )}

        {step === 'when' && (
          <WizardStep {...position} title="How often?" errors={errors} onBack={goBack} next={next}>
            <Segmented label="How often" options={FREQUENCIES} value={frequency} onChange={setFrequency} />
            <TextField
              label="First one due"
              type="date"
              min={today}
              value={firstOn}
              onChange={(e) => setFirstOn(e.target.value)}
            />
          </WizardStep>
        )}

        {step === 'end' && (
          <WizardStep
            {...position}
            title="Does it end?"
            hint="You can pause or stop it any time."
            errors={errors}
            onBack={goBack}
            next={next}
          >
            <Switch label="Ends on a date" checked={ends} onChange={setEnds} />
            {ends && (
              <TextField
                label="Last one on or before"
                type="date"
                min={firstOn}
                value={endOn}
                onChange={(e) => setEndOn(e.target.value)}
              />
            )}
          </WizardStep>
        )}

        {step === 'review' && (
          <WizardStep
            {...position}
            title="Check and send"
            hint={`${first} accepts once. After that, each one is added automatically on its date.`}
            errors={errors}
            onBack={goBack}
            next={{ label: `Send to ${first}`, submit: true, busy }}
          >
            <Card className="space-y-1">
              <p className="font-semibold">{description.trim()}</p>
              <p className="font-display text-3xl font-semibold tabular-nums">{formatCents(amountCents)}</p>
              <p className="text-ink-muted">
                {FREQUENCY_LABELS[frequency]}, from {formatDate(firstOn as IsoDate)}
                {ends ? ` to ${formatDate(endOn as IsoDate)}` : ''}
              </p>
            </Card>
          </WizardStep>
        )}
      </form>
    </div>
  )
}
