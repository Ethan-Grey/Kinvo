import { useState, type FormEvent } from 'react'
import { todayInNZ } from '../../domain/dates'
import {
  createInvite,
  listOpenInvites,
  revokeInvite,
  type CreatedInvite,
  type ExistingDebtInput,
} from '../../data/invites'
import type { TermsInput } from '../../data/loans'
import { useAsync } from '../../shared/useAsync'
import { Button, Card, Notice, Spinner, TextField } from '../../shared/ui'
import { TermsForm } from '../loans/TermsForm'

const dateFormat = new Intl.DateTimeFormat('en-NZ', { day: 'numeric', month: 'short', timeZone: 'Pacific/Auckland' })

/** Lender-only: create invite links and manage unused ones. */
export function InvitePanel() {
  const [invites, reloadInvites] = useAsync(listOpenInvites)
  const [note, setNote] = useState('')
  const [creating, setCreating] = useState(false)
  const [created, setCreated] = useState<CreatedInvite | null>(null)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [withDebt, setWithDebt] = useState(false)
  const [debtReason, setDebtReason] = useState('')
  const [lentOn, setLentOn] = useState('')
  // Remounts the debt form after each invite so it starts empty.
  const [formKey, setFormKey] = useState(0)

  function invited(invite: CreatedInvite) {
    setCreated(invite)
    setNote('')
    setDebtReason('')
    setLentOn('')
    setWithDebt(false)
    setFormKey((k) => k + 1)
    reloadInvites()
  }

  async function handleCreate(event: FormEvent) {
    event.preventDefault()
    setCreating(true)
    setError(null)
    setCopied(false)
    try {
      invited(await createInvite(note.trim()))
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setCreating(false)
    }
  }

  /** Invite with a debt from before Kinvo. The TermsForm shows its own errors. */
  async function handleCreateWithDebt(terms: TermsInput) {
    if (!lentOn) throw new Error('Enter roughly when you lent the money.')
    setError(null)
    setCopied(false)
    const debt: ExistingDebtInput = {
      amountCents: terms.principalCents,
      lentOn,
      reason: debtReason,
      instalments: terms.instalments,
      lateTerms: terms.lateTerms,
      conditions: terms.conditions,
    }
    invited(await createInvite(note.trim(), debt))
  }

  async function handleShare(invite: CreatedInvite) {
    const shareData = { title: 'Kinvo invite', text: 'Join me on Kinvo', url: invite.url }
    if (navigator.share) {
      try {
        await navigator.share(shareData)
        return
      } catch {
        // User cancelled the share sheet; fall back to copying.
      }
    }
    await navigator.clipboard.writeText(invite.url)
    setCopied(true)
  }

  async function handleRevoke(id: string) {
    setError(null)
    try {
      await revokeInvite(id)
      if (created?.id === id) setCreated(null)
      reloadInvites()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <Card className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Invite a borrower</h2>
        <p className="text-sm text-ink-muted">Each link works once and expires after 7 days.</p>
      </div>

      <TextField
        label="Who is it for? (optional)"
        maxLength={80}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="e.g. Cousin Sam"
      />

      <label className="flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          checked={withDebt}
          onChange={(e) => setWithDebt(e.target.checked)}
          className="mt-0.5 size-5 shrink-0 accent-brand"
        />
        <span>
          <span className="font-medium">They already owe me money</span>
          <span className="block text-ink-muted">
            Add a debt from before Kinvo. They’ll be asked to confirm it when they join.
          </span>
        </span>
      </label>

      {withDebt ? (
        <div className="border-t border-line pt-4">
          <TermsForm
            key={formKey}
            variant="existing_debt"
            submitLabel="Create invite link"
            onSubmit={handleCreateWithDebt}
            reviewExtras={
              <div className="grid grid-cols-2 gap-3">
                <TextField
                  label="Originally lent on"
                  type="date"
                  max={todayInNZ()}
                  required
                  value={lentOn}
                  onChange={(e) => setLentOn(e.target.value)}
                  hint="Roughly is fine"
                />
                <TextField
                  label="What for? (optional)"
                  maxLength={500}
                  value={debtReason}
                  onChange={(e) => setDebtReason(e.target.value)}
                  placeholder="e.g. Car rego"
                />
              </div>
            }
          />
        </div>
      ) : (
        <form onSubmit={handleCreate}>
          <Button type="submit" busy={creating} className="w-full">
            Create invite link
          </Button>
        </form>
      )}

      {created && (
        <div className="space-y-2 rounded-xl bg-brand-soft p-3 text-on-brand-soft">
          <p className="text-sm font-medium">Send this link to them. You won’t be able to see it again.</p>
          <code className="block break-all rounded-lg bg-surface px-2 py-1.5 text-xs text-ink">{created.url}</code>
          <Button variant="secondary" onClick={() => handleShare(created)}>
            {copied ? 'Copied' : 'Share link'}
          </Button>
        </div>
      )}

      {error && <Notice tone="error">{error}</Notice>}

      {invites.status === 'loading' && <Spinner label="Loading invites…" />}
      {invites.status === 'error' && <Notice tone="error">{invites.error.message}</Notice>}
      {invites.status === 'success' && invites.data.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-ink-muted">Unused invites</h3>
          <ul className="mt-2 divide-y divide-line">
            {invites.data.map((invite) => (
              <li key={invite.id} className="flex items-center justify-between py-2 text-sm">
                <span>
                  {invite.note ?? 'Unnamed invite'}
                  <span className="text-ink-muted"> · expires {dateFormat.format(new Date(invite.expires_at))}</span>
                </span>
                <Button variant="ghost" onClick={() => handleRevoke(invite.id)}>
                  Revoke
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  )
}
