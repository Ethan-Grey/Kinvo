import { useState, type FormEvent } from 'react'
import { exportFileName, exportMyData, setDisplayName, setEmailNotifications } from '../../data/account'
import { signOut } from '../../data/auth'
import type { Profile } from '../../data/database.types'
import { getMyProfile } from '../../data/people'
import { ThemeToggle } from '../../shared/ThemeToggle'
import { useAsync } from '../../shared/useAsync'
import { Button, Card, Notice, Spinner, TextField } from '../../shared/ui'
import { useAuth } from '../auth/useAuth'

/** Your name, email switch, theme, data download and sign out. */
export function AccountPage() {
  const { session } = useAuth()
  const userId = session?.user.id ?? ''
  const [profile] = useAsync(() => getMyProfile(userId), userId)

  if (profile.status === 'loading') return <Spinner label="Loading…" />
  if (profile.status === 'error') return <Notice tone="error">{profile.error.message}</Notice>

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold tracking-tight">Account</h1>
      <DetailsCard profile={profile.data} />
      <EmailCard profile={profile.data} />
      <Card>
        <h2 className="font-semibold">Appearance</h2>
        <div className="mt-3">
          <ThemeToggle />
        </div>
      </Card>
      <DataCard />
      <SignOutButton />
    </div>
  )
}

// Each card keeps its own saved value rather than reloading the page, so the
// confirmation message and focus stay where they are.
function DetailsCard({ profile }: { profile: Profile }) {
  const [savedName, setSavedName] = useState(profile.display_name)
  const [name, setName] = useState(profile.display_name)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)
  const unchanged = name.trim() === savedName

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setMessage(null)
    try {
      await setDisplayName(name.trim())
      setSavedName(name.trim())
      setMessage({ tone: 'success', text: 'Name saved.' })
    } catch (err) {
      setMessage({ tone: 'error', text: err instanceof Error ? err.message : String(err) })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <h2 className="font-semibold">Your details</h2>
      <form onSubmit={handleSubmit} className="mt-3 space-y-3">
        <TextField
          label="Name"
          hint="This is what the people you lend to or borrow from see."
          value={name}
          maxLength={80}
          required
          autoComplete="name"
          onChange={(e) => setName(e.target.value)}
        />
        <p className="text-sm">
          <span className="text-ink-muted">Email: </span>
          {profile.email}
        </p>
        {message && <Notice tone={message.tone}>{message.text}</Notice>}
        <Button type="submit" variant="secondary" busy={saving} disabled={unchanged}>
          Save name
        </Button>
      </form>
    </Card>
  )
}

function EmailCard({ profile }: { profile: Profile }) {
  const [enabled, setEnabled] = useState(profile.email_notifications)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleChange(next: boolean) {
    setSaving(true)
    setError(null)
    try {
      await setEmailNotifications(next)
      setEnabled(next)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <h2 className="font-semibold">Notifications</h2>
      <label className="mt-3 flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          checked={enabled}
          disabled={saving}
          onChange={(e) => handleChange(e.target.checked)}
          className="mt-0.5 size-5 shrink-0 accent-brand"
        />
        <span>
          <span className="font-medium">Email me</span>
          <span className="block text-ink-muted">
            Loan updates, payments and due-date reminders. Notifications in the app always stay on.
          </span>
        </span>
      </label>
      {error && (
        <div className="mt-3">
          <Notice tone="error">{error}</Notice>
        </div>
      )}
    </Card>
  )
}

function DataCard() {
  const [downloading, setDownloading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleDownload() {
    setDownloading(true)
    setError(null)
    try {
      const json = await exportMyData()
      const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
      const link = document.createElement('a')
      link.href = url
      link.download = exportFileName()
      link.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setDownloading(false)
    }
  }

  return (
    <Card>
      <h2 className="font-semibold">Your data</h2>
      <p className="mt-1 text-sm text-ink-muted">
        A copy of everything Kinvo holds that involves you: your loans, agreements, payments and activity, as a JSON
        file.
      </p>
      {error && (
        <div className="mt-3">
          <Notice tone="error">{error}</Notice>
        </div>
      )}
      <Button variant="secondary" className="mt-3" busy={downloading} onClick={handleDownload}>
        Download my data
      </Button>
    </Card>
  )
}

function SignOutButton() {
  const [signingOut, setSigningOut] = useState(false)

  async function handleSignOut() {
    setSigningOut(true)
    try {
      await signOut()
    } finally {
      setSigningOut(false)
    }
  }

  return (
    <Button variant="secondary" className="w-full" busy={signingOut} onClick={handleSignOut}>
      Sign out
    </Button>
  )
}
