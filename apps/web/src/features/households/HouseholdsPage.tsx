import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { todayInNZ } from '../../domain/dates'
import { netWith, balanceOn } from '../../domain/household'
import { formatCents, formatSignedCents, parseDollars, toCents } from '../../domain/money'
import { messageFor } from '../../data/errors'
import { acceptHouseholdInvite, createHousehold, listHouseholds, previewHouseholdInvite } from '../../data/households'
import { Avatar } from '../../shared/Avatar'
import { ChevronIcon, HomeIcon, PlusIcon } from '../../shared/icons'
import { useAsync } from '../../shared/useAsync'
import { Button, Card, EmptyState, Notice, PageHeader, PageSkeleton, Spinner, Switch, TextField } from '../../shared/ui'
import { WizardStep } from '../../shared/Wizard'
import { useAuth } from '../auth/useAuth'

/** /households — the households you're in. */
export function HouseholdsPage() {
  const [data] = useAsync(() => listHouseholds(), 'households')
  if (data.status === 'loading') return <PageSkeleton label="Loading households" />
  if (data.status === 'error') return <Notice tone="error">{data.error.message}</Notice>

  return (
    <div className="space-y-5">
      <PageHeader title="Households" />
      {data.data.length === 0 ? (
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
            Share rent, bills and groceries with the people you live with. Every household can be set up its own way.
          </EmptyState>
        </Card>
      ) : (
        <>
          <HouseholdCards households={data.data} />
          <Link
            to="/households/new"
            className="flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-line font-semibold hover:border-brand-ink"
          >
            <PlusIcon className="size-5" />
            Create another household
          </Link>
        </>
      )}
    </div>
  )
}

/** One card per household: who's in it, the shared account, and where you stand. Used on Home too. */
export function HouseholdCards({ households }: { households: Awaited<ReturnType<typeof listHouseholds>> }) {
  const { session } = useAuth()
  const me = session?.user.id ?? ''
  const today = todayInNZ()
  return (
    <ul className="space-y-3">
      {households.map((h) => {
        const others = h.members.filter((m) => m.userId !== me)
        const net = others.reduce((sum, m) => sum + netWith(h.tab, me, m.userId), 0)
        return (
          <li key={h.id}>
            <Link
              to={`/households/${h.id}`}
              className="block space-y-3 rounded-3xl border border-line p-4 hover:border-brand-ink focus-visible:outline-2 focus-visible:outline-brand-ink"
            >
              <div className="flex items-center gap-3">
                <span className="flex -space-x-2" aria-hidden="true">
                  {h.members.slice(0, 4).map((m) => (
                    <span key={m.userId} className="rounded-full ring-2 ring-canvas">
                      <Avatar name={m.name} photo={m.photo} size="sm" />
                    </span>
                  ))}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-display text-lg font-semibold">{h.name}</span>
                  <span className="block text-sm text-ink-muted">
                    {h.members.length === 1 ? 'Just you so far' : `${h.members.length} people`}
                  </span>
                </span>
                <ChevronIcon className="size-5 text-ink-muted" />
              </div>
              <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm tabular-nums">
                {h.hasSharedAccount && (
                  <span>
                    <span className="text-ink-muted">{h.sharedAccountName ?? 'Shared account'} </span>
                    <span className="font-semibold">{formatSignedCents(balanceOn(h.sharedEntries, today))}</span>
                  </span>
                )}
                {others.length > 0 && (
                  <span className={net < 0 ? 'font-semibold text-danger' : 'font-semibold'}>
                    {net === 0
                      ? 'All square'
                      : net > 0
                        ? `You’re owed ${formatCents(toCents(net))}`
                        : `You owe ${formatCents(toCents(-net))}`}
                  </span>
                )}
              </div>
            </Link>
          </li>
        )
      })}
    </ul>
  )
}

/** /households/new — name it, and whether it has a shared account. */
export function NewHouseholdPage() {
  const navigate = useNavigate()
  const [step, setStep] = useState<'name' | 'account'>('name')
  const [name, setName] = useState('')
  const [shared, setShared] = useState(false)
  const [accountName, setAccountName] = useState('')
  const [balanceText, setBalanceText] = useState('')
  const [errors, setErrors] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (step === 'name') {
      if (!name.trim()) return setErrors(['Give the household a name, e.g. Our place.'])
      setErrors([])
      return setStep('account')
    }
    const balance = balanceText.trim() ? parseDollars(balanceText) : null
    if (shared && balance && !balance.ok) return setErrors(['Enter the balance like 812.50, or leave it blank.'])
    setBusy(true)
    setErrors([])
    try {
      const id = await createHousehold({
        name,
        hasSharedAccount: shared,
        sharedAccountName: shared ? accountName.trim() || null : null,
        openingBalanceCents: shared && balance?.ok ? balance.cents : null,
      })
      navigate(`/households/${id}`, {
        replace: true,
        state: { flash: 'Household created. Invite the people you live with.' },
      })
    } catch (err) {
      setErrors([(err as Error).message])
      setBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader back={{ to: '/households', label: 'Households' }} title="New household" />
      <form onSubmit={handleSubmit} noValidate>
        {step === 'name' ? (
          <WizardStep
            step={1}
            of={2}
            title="What’s it called?"
            errors={errors}
            next={{ label: 'Continue', submit: true }}
          >
            <TextField
              label="Household name"
              maxLength={60}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Our place, Mum’s"
              autoFocus
            />
          </WizardStep>
        ) : (
          <WizardStep
            step={2}
            of={2}
            title="Is there a shared account?"
            hint="A bank account everyone puts money into, that bills come out of. Skip it if you don’t have one."
            errors={errors}
            onBack={() => setStep('name')}
            next={{ label: 'Create household', submit: true, busy }}
          >
            <Switch label="We have a shared account" checked={shared} onChange={setShared} />
            {shared && (
              <>
                <TextField
                  label="What you call it (optional)"
                  maxLength={60}
                  value={accountName}
                  onChange={(e) => setAccountName(e.target.value)}
                  placeholder="e.g. Joint Co-op"
                />
                <TextField
                  label="Roughly what’s in it now (optional)"
                  inputMode="decimal"
                  value={balanceText}
                  onChange={(e) => setBalanceText(e.target.value)}
                  hint="You can correct it any time from your banking app."
                />
              </>
            )}
          </WizardStep>
        )}
      </form>
    </div>
  )
}

/** /household-invite/:token — join a household. */
export function HouseholdInvitePage() {
  const { token = '' } = useParams()
  const navigate = useNavigate()
  const [preview] = useAsync(() => previewHouseholdInvite(token), token)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (preview.status === 'loading') return <Spinner label="Checking your invite…" />
  if (preview.status === 'error') return <Notice tone="error">{preview.error.message}</Notice>
  const { status, householdName, invitedBy } = preview.data

  async function join() {
    setBusy(true)
    setError(null)
    try {
      const id = await acceptHouseholdInvite(token)
      navigate(`/households/${id}`, {
        replace: true,
        state: { flash: `You’ve joined ${householdName ?? 'the household'}.` },
      })
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  if (status === 'already_member') {
    return (
      <Card className="space-y-4">
        <p>You’re already in {householdName}.</p>
        <Button onClick={join} className="w-full">
          Open it
        </Button>
      </Card>
    )
  }
  if (status !== 'valid') {
    return (
      <Card className="space-y-4">
        <Notice tone="error">{messageFor(status === 'not_found' ? 'invite_not_found' : `invite_${status}`)}</Notice>
        <Link to="/" className="text-sm font-medium text-brand-ink underline">
          Go home
        </Link>
      </Card>
    )
  }
  return (
    <Card className="space-y-4">
      <h1 className="text-xl font-semibold">
        {invitedBy} invited you to {householdName}
      </h1>
      <p className="text-sm text-ink-muted">
        You’ll share bills and see the household’s shared account and tab. Everyone in it sees your name. Your loans
        stay private.
      </p>
      {error && <Notice tone="error">{error}</Notice>}
      <Button onClick={join} busy={busy} className="w-full">
        Join {householdName}
      </Button>
    </Card>
  )
}
