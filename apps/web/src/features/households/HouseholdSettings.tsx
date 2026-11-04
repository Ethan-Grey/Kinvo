import { useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router'
import { equalShares, netWith } from '../../domain/household'
import { formatCents, parseDollars, toCents } from '../../domain/money'
import {
  getHousehold,
  leaveHousehold,
  memberName,
  setHouseholdShares,
  settleUp,
  updateHousehold,
  type HouseholdDetail,
} from '../../data/households'
import { useAsync } from '../../shared/useAsync'
import { Button, Card, Notice, PageHeader, PageSkeleton, Segmented, Switch, TextField } from '../../shared/ui'
import { MoneyField } from '../../shared/Wizard'
import { useAuth } from '../auth/useAuth'

function useHousehold() {
  const { id = '' } = useParams()
  const { session } = useAuth()
  const [data, reload] = useAsync(() => getHousehold(id), id)
  return { data, reload, me: session?.user.id ?? '' }
}

/** /households/:id/settle/:userId — record that you paid someone what you owe them. */
export function SettlePage() {
  const { userId = '' } = useParams()
  const { data, me } = useHousehold()
  if (data.status === 'loading') return <PageSkeleton label="Loading" />
  if (data.status === 'error') return <Notice tone="error">{data.error.message}</Notice>
  return <SettleForm h={data.data} me={me} other={userId} />
}

function SettleForm({ h, me, other }: { h: HouseholdDetail; me: string; other: string }) {
  const navigate = useNavigate()
  const owed = -netWith(h.tab, me, other)
  const first = memberName(h, other, me)
  const [text, setText] = useState(owed > 0 ? String(owed / 100) : '')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const amount = parseDollars(text)
    if (!amount.ok || amount.cents < 1) return setError('Enter how much you paid.')
    setBusy(true)
    setError(null)
    try {
      await settleUp(h.id, other, amount.cents, note)
      navigate(`/households/${h.id}`, { replace: true, state: { flash: `Recorded. ${first} has been told.` } })
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader back={{ to: `/households/${h.id}`, label: h.name }} title={`Settle up with ${first}`} />
      <form onSubmit={handleSubmit} className="space-y-5">
        <p className="text-ink-muted">
          {owed > 0 ? `You owe ${first} ${formatCents(toCents(owed))}.` : `You don’t owe ${first} anything right now.`}{' '}
          Pay them in your banking app, then record it here.
        </p>
        <MoneyField label="Amount you paid" value={text} onChange={setText} />
        <TextField
          label="Note (optional)"
          maxLength={200}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. Bank transfer, October"
        />
        {error && <Notice tone="error">{error}</Notice>}
        <Button type="submit" className="w-full" busy={busy}>
          Record payment to {first}
        </Button>
      </form>
    </div>
  )
}

/** /households/:id/settings — name, shared account, default split, people. */
export function HouseholdSettingsPage() {
  const { data, reload, me } = useHousehold()
  if (data.status === 'loading') return <PageSkeleton label="Loading" />
  if (data.status === 'error') return <Notice tone="error">{data.error.message}</Notice>
  return <Settings h={data.data} me={me} onChanged={reload} />
}

function Settings({ h, me, onChanged }: { h: HouseholdDetail; me: string; onChanged: () => void }) {
  const navigate = useNavigate()
  const isOwner = h.members.find((m) => m.userId === me)?.role === 'owner'
  const [name, setName] = useState(h.name)
  const [shared, setShared] = useState(h.hasSharedAccount)
  const [accountName, setAccountName] = useState(h.sharedAccountName ?? '')
  const [splitMode, setSplitMode] = useState<'equal' | 'custom'>(
    h.members.every((m) => m.shareBp !== null) ? 'custom' : 'equal',
  )
  const [percents, setPercents] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      (h.members.every((m) => m.shareBp !== null)
        ? h.members.map((m) => ({ userId: m.userId, shareBp: m.shareBp ?? 0 }))
        : equalShares(h.members.map((m) => m.userId))
      ).map((s) => [s.userId, String(s.shareBp / 100)]),
    ),
  )
  const [status, setStatus] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  async function run(key: string, action: () => Promise<unknown>, text: string) {
    setBusy(key)
    setStatus(null)
    try {
      await action()
      setStatus({ tone: 'success', text })
      onChanged()
    } catch (err) {
      setStatus({ tone: 'error', text: (err as Error).message })
    } finally {
      setBusy(null)
    }
  }

  function saveDetails(event: FormEvent) {
    event.preventDefault()
    void run('details', () => updateHousehold(h.id, name, shared, shared ? accountName.trim() || null : null), 'Saved.')
  }

  function saveSplit(event: FormEvent) {
    event.preventDefault()
    if (splitMode === 'equal') return void run('split', () => setHouseholdShares(h.id, null), 'Bills now split evenly.')
    const shares = h.members.map((m) => ({
      userId: m.userId,
      shareBp: Math.round(Number(percents[m.userId] || 0) * 100),
    }))
    if (shares.reduce((sum, s) => sum + s.shareBp, 0) !== 10000) {
      return setStatus({ tone: 'error', text: 'The percentages must add up to 100.' })
    }
    void run('split', () => setHouseholdShares(h.id, shares), 'Split saved.')
  }

  return (
    <div className="space-y-6">
      <PageHeader back={{ to: `/households/${h.id}`, label: h.name }} title="Household settings" />
      {status && <Notice tone={status.tone}>{status.text}</Notice>}

      <Card>
        <form onSubmit={saveDetails} className="space-y-4">
          <TextField label="Household name" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
          <Switch
            label="Shared account"
            description="A bank account everyone tops up, that bills come out of."
            checked={shared}
            onChange={setShared}
          />
          {shared && (
            <TextField
              label="What you call it (optional)"
              maxLength={60}
              value={accountName}
              onChange={(e) => setAccountName(e.target.value)}
            />
          )}
          <Button type="submit" className="w-full" busy={busy === 'details'}>
            Save
          </Button>
        </form>
      </Card>

      {h.members.length > 1 && (
        <Card>
          <form onSubmit={saveSplit} className="space-y-4">
            <div>
              <h2 className="font-semibold">How bills are usually split</h2>
              <p className="text-sm text-ink-muted">Any bill can still have its own split.</p>
            </div>
            <Segmented
              label="Default split"
              options={[
                { value: 'equal', label: 'Evenly' },
                { value: 'custom', label: 'Set percentages' },
              ]}
              value={splitMode}
              onChange={setSplitMode}
            />
            {splitMode === 'custom' && (
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
            <Button type="submit" className="w-full" busy={busy === 'split'}>
              Save split
            </Button>
          </form>
        </Card>
      )}

      <Card className="space-y-3">
        <h2 className="font-semibold">People</h2>
        <ul className="divide-y divide-line">
          {h.members.map((m) => (
            <li key={m.userId} className="flex items-center gap-3 py-2">
              <span className="min-w-0 flex-1">{m.userId === me ? `${m.name} (you)` : m.name}</span>
              {isOwner && m.userId !== me && (
                <Button
                  variant="ghost"
                  className="min-h-10 px-3 text-sm"
                  busy={busy === m.userId}
                  onClick={() => {
                    if (window.confirm(`Remove ${m.name} from ${h.name}? What they owe or are owed stays on record.`)) {
                      void run(m.userId, () => leaveHousehold(h.id, m.userId), `${m.name} removed.`)
                    }
                  }}
                >
                  Remove<span className="sr-only"> {m.name}</span>
                </Button>
              )}
            </li>
          ))}
        </ul>
      </Card>

      <Button
        variant="danger"
        className="w-full"
        busy={busy === 'leave'}
        onClick={async () => {
          if (!window.confirm(`Leave ${h.name}? You won’t see it any more. What you owe or are owed stays on record.`))
            return
          setBusy('leave')
          try {
            await leaveHousehold(h.id)
            navigate('/households', { replace: true })
          } catch (err) {
            setStatus({ tone: 'error', text: (err as Error).message })
            setBusy(null)
          }
        }}
      >
        Leave this household
      </Button>
    </div>
  )
}
