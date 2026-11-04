import { useState, type FormEvent } from 'react'
import { setDisplayName } from '../../data/account'
import type { Profile } from '../../data/database.types'
import { Button, Logo, Notice, TextField } from '../../shared/ui'
import { ProfilePhoto } from './ProfilePhoto'

/**
 * Shown once, before anything else, until the person confirms their real
 * name. Email sign-ins start with the first part of the email address as a
 * name, which isn't what family members should see.
 */
export function NameSetup({ profile, onDone }: { profile: Profile; onDone: () => void }) {
  const fromEmail = profile.display_name === profile.email.split('@')[0]
  const [name, setName] = useState(fromEmail ? '' : profile.display_name)
  const [photo, setPhoto] = useState(profile.avatar_path)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await setDisplayName(name)
      onDone()
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mx-auto max-w-sm space-y-6 pt-6">
      <div className="flex items-center gap-3">
        <Logo className="size-10" />
        <p className="font-display text-xl font-semibold">Welcome to Kinvo</p>
      </div>
      <div>
        <h1 className="text-[1.75rem] leading-tight font-semibold">What’s your name?</h1>
        <p className="mt-1 text-ink-muted">
          This is what the people you’re connected with will see, so use your real name.
        </p>
      </div>
      <TextField
        label="Your name"
        autoComplete="name"
        autoCapitalize="words"
        required
        maxLength={80}
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="e.g. Hana Grey"
      />
      <div>
        <p className="mb-3 text-sm font-medium">Photo (optional)</p>
        <ProfilePhoto userId={profile.id} name={name || '?'} photo={photo} onChange={setPhoto} />
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      <Button type="submit" className="w-full" busy={busy}>
        Continue
      </Button>
    </form>
  )
}
