import { useState, type FormEvent } from 'react'
import { Navigate, useSearchParams } from 'react-router'
import { sendMagicLink, signInWithGoogle } from '../../data/auth'
import { safeNextPath } from '../../shared/navigation'
import { Button, Card, Logo, Notice, TextField } from '../../shared/ui'
import { useAuth } from './useAuth'

type Status =
  | { kind: 'idle' }
  | { kind: 'busy'; method: 'google' | 'email' }
  | { kind: 'sent'; email: string }
  | { kind: 'error'; message: string }

export function SignInPage() {
  const { session } = useAuth()
  const [params] = useSearchParams()
  const next = safeNextPath(params.get('next'))
  const arrivingFromInvite = next.startsWith('/invite/')

  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<Status>({ kind: 'idle' })

  if (session) return <Navigate to={next} replace />

  async function handleGoogle() {
    setStatus({ kind: 'busy', method: 'google' })
    try {
      await signInWithGoogle(next) // the browser leaves the page here
    } catch (error) {
      setStatus({ kind: 'error', message: (error as Error).message })
    }
  }

  async function handleEmail(event: FormEvent) {
    event.preventDefault()
    setStatus({ kind: 'busy', method: 'email' })
    try {
      await sendMagicLink(email.trim(), next)
      setStatus({ kind: 'sent', email: email.trim() })
    } catch (error) {
      setStatus({ kind: 'error', message: (error as Error).message })
    }
  }

  const busy = status.kind === 'busy'

  return (
    <main className="mx-auto flex min-h-svh max-w-sm flex-col justify-center gap-6 px-4 py-12">
      <header className="flex items-center gap-3">
        <Logo className="size-10" />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Sign in to Kinvo</h1>
          <p className="text-sm text-ink-muted">
            {arrivingFromInvite ? 'Sign in to accept your invite.' : 'Your private family lending ledger.'}
          </p>
        </div>
      </header>

      <Card className="space-y-5">
        {status.kind === 'sent' ? (
          <Notice tone="success">
            Check <strong>{status.email}</strong> for a sign-in link. Open it on this device.
          </Notice>
        ) : (
          <>
            <Button
              variant="secondary"
              className="w-full"
              onClick={handleGoogle}
              busy={status.kind === 'busy' && status.method === 'google'}
              disabled={busy}
            >
              <GoogleMark />
              Continue with Google
            </Button>

            <div className="flex items-center gap-3 text-xs text-ink-muted">
              <span className="h-px flex-1 bg-line" />
              or
              <span className="h-px flex-1 bg-line" />
            </div>

            <form onSubmit={handleEmail} className="space-y-3">
              <TextField
                label="Email"
                type="email"
                autoComplete="email"
                inputMode="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                hint="We’ll email you a link. No password needed."
              />
              <Button
                type="submit"
                className="w-full"
                busy={status.kind === 'busy' && status.method === 'email'}
                disabled={busy}
              >
                Email me a sign-in link
              </Button>
            </form>
          </>
        )}

        {status.kind === 'error' && <Notice tone="error">{status.message}</Notice>}
      </Card>
    </main>
  )
}

function GoogleMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 48 48" className="size-4">
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.6 13.3l7.9 6.1C12.4 13.7 17.7 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 7l7.1 5.5c4.2-3.9 7.2-9.6 7.2-17z" />
      <path fill="#FBBC05" d="M10.5 28.6A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.2.8-4.6l-7.9-6.1A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.7l7.9-6.1z" />
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.1-5.5c-2 1.4-4.6 2.3-8.8 2.3-6.3 0-11.6-4.2-13.5-9.9l-7.9 6.1C6.6 42.6 14.6 48 24 48z" />
    </svg>
  )
}
