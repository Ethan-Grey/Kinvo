import { useState, type FormEvent } from 'react'
import { createInvite, listOpenInvites, revokeInvite, type CreatedInvite } from '../../data/invites'
import { useAsync } from '../../shared/useAsync'
import { Button, Card, Notice, Spinner, TextField } from '../../shared/ui'

const dateFormat = new Intl.DateTimeFormat('en-NZ', { day: 'numeric', month: 'short', timeZone: 'Pacific/Auckland' })

/** Lender-only: create invite links and manage unused ones. */
export function InvitePanel() {
  const [invites, reloadInvites] = useAsync(listOpenInvites)
  const [note, setNote] = useState('')
  const [creating, setCreating] = useState(false)
  const [created, setCreated] = useState<CreatedInvite | null>(null)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleCreate(event: FormEvent) {
    event.preventDefault()
    setCreating(true)
    setError(null)
    setCopied(false)
    try {
      setCreated(await createInvite(note.trim()))
      setNote('')
      reloadInvites()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setCreating(false)
    }
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
        <h2 className="font-semibold">Invite a borrower</h2>
        <p className="text-sm text-ink-muted">Each link works once and expires after 7 days.</p>
      </div>

      <form onSubmit={handleCreate} className="flex items-end gap-2">
        <TextField
          label="Who is it for? (optional)"
          maxLength={80}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. Cousin Sam"
          className="flex-1"
        />
        <Button type="submit" busy={creating}>
          Create link
        </Button>
      </form>

      {created && (
        <div className="space-y-2 rounded-xl bg-brand-soft p-3">
          <p className="text-sm font-medium">Send this link to them. You won’t be able to see it again.</p>
          <code className="block break-all rounded-lg bg-surface px-2 py-1.5 text-xs">{created.url}</code>
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
