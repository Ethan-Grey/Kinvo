import { useState, type FormEvent } from 'react'
import { exportFileName, exportMyData, setDisplayName, setEmailNotifications } from '../../data/account'
import { signOut } from '../../data/auth'
import type { Profile } from '../../data/database.types'
import { getMyProfile } from '../../data/people'
import { Link } from 'react-router'
import { ChevronIcon, DownloadIcon, MailIcon, PaletteIcon, PeopleIcon, SignOutIcon } from '../../shared/icons'
import { ThemeToggle } from '../../shared/ThemeToggle'
import { useAsync } from '../../shared/useAsync'
import { Button, Card, IconBubble, Notice, PageSkeleton, TextField } from '../../shared/ui'
import { useAuth } from '../auth/useAuth'
import { PhoneNotificationsCard } from './PhoneNotifications'
import { ProfilePhoto } from './ProfilePhoto'

/** Your name, email switch, theme, data download and sign out. */
export function AccountPage() {
  const { session } = useAuth()
  const userId = session?.user.id ?? ''
  const [profile] = useAsync(() => getMyProfile(userId), userId)
  const [photo, setPhoto] = useState<string | null | undefined>(undefined)

  if (profile.status === 'loading') return <PageSkeleton label="Loading your account" />
  if (profile.status === 'error') return <Notice tone="error">{profile.error.message}</Notice>

  return (
    <div className="space-y-5">
      <h1 className="sr-only">Account</h1>
      <section className="flex flex-col items-center pt-2 text-center">
        <ProfilePhoto
          userId={userId}
          name={profile.data.display_name}
          photo={photo === undefined ? profile.data.avatar_path : photo}
          onChange={setPhoto}
        />
        <p className="mt-3 font-display text-2xl font-semibold">{profile.data.display_name}</p>
        <p className="text-sm text-ink-muted">{profile.data.email}</p>
      </section>
      <DetailsCard profile={profile.data} />
      <PhoneNotificationsCard />
      <EmailCard profile={profile.data} />
      <Card>
        <div className="flex items-center gap-3">
          <IconBubble>
            <PaletteIcon />
          </IconBubble>
          <h2 className="flex-1 text-lg font-semibold">Appearance</h2>
          <ThemeToggle />
        </div>
      </Card>
      <Link
        to="/people"
        className="flex items-center gap-3 rounded-3xl border border-line p-5 transition hover:border-brand-ink active:scale-[0.99]"
      >
        <IconBubble>
          <PeopleIcon />
        </IconBubble>
        <span className="min-w-0 flex-1">
          <span className="block font-display text-lg font-semibold">People and invites</span>
          <span className="block text-sm text-ink-muted">Who owes you and who you owe</span>
        </span>
        <ChevronIcon className="size-5 text-ink-muted" />
      </Link>
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
      <h2 className="text-lg font-semibold">Your details</h2>
      <form onSubmit={handleSubmit} className="mt-3 space-y-3">
        <TextField
          label="Name"
          hint="This is what the people you’re connected with see."
          value={name}
          maxLength={80}
          required
          autoComplete="name"
          onChange={(e) => setName(e.target.value)}
        />
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
      <label className="flex cursor-pointer items-center gap-3">
        <IconBubble>
          <MailIcon />
        </IconBubble>
        <span className="min-w-0 flex-1">
          <span className="block font-display text-lg font-semibold">Email me</span>
          <span className="block text-sm text-ink-muted">
            New requests, payments and due-date reminders. Alerts in the app always stay on.
          </span>
        </span>
        <input
          type="checkbox"
          role="switch"
          checked={enabled}
          disabled={saving}
          onChange={(e) => handleChange(e.target.checked)}
          className="peer sr-only"
        />
        <span
          aria-hidden="true"
          className={
            'relative h-7 w-12 shrink-0 rounded-full bg-ring-track transition-colors peer-checked:bg-brand ' +
            'peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand-ink ' +
            'peer-disabled:opacity-60 after:absolute after:top-1 after:left-1 after:size-5 after:rounded-full ' +
            'after:bg-white after:shadow after:transition-transform peer-checked:after:translate-x-5'
          }
        />
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
      <div className="flex items-start gap-3">
        <IconBubble>
          <DownloadIcon />
        </IconBubble>
        <div className="min-w-0">
          <h2 className="text-lg font-semibold">Your data</h2>
          <p className="text-sm text-ink-muted">
            A copy of everything Kinvo holds that involves you: what’s owed, agreements, payments and activity, as a
            JSON file.
          </p>
        </div>
      </div>
      {error && (
        <div className="mt-3">
          <Notice tone="error">{error}</Notice>
        </div>
      )}
      <Button variant="secondary" className="mt-4 w-full" busy={downloading} onClick={handleDownload}>
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
    <Button variant="danger" className="w-full" busy={signingOut} onClick={handleSignOut}>
      {!signingOut && <SignOutIcon className="size-5" />}
      Sign out
    </Button>
  )
}
