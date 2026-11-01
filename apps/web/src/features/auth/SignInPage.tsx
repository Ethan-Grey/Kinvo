import { useState, type FormEvent } from 'react'
import { Navigate, useSearchParams } from 'react-router'
import { sendSignInCode, signInWithGoogle, verifySignInCode } from '../../data/auth'
import { safeNextPath } from '../../shared/navigation'
import { Button, Card, Logo, Notice, TextField } from '../../shared/ui'
import { useAuth } from './useAuth'

type Step = { kind: 'email' } | { kind: 'code'; email: string }

export function SignInPage() {
  const { session } = useAuth()
  const [params] = useSearchParams()
  const next = safeNextPath(params.get('next'))
  const arrivingFromInvite = next.startsWith('/invite/')

  const [step, setStep] = useState<Step>({ kind: 'email' })

  // Once signed in (by code, or in another tab), continue to the destination.
  if (session) return <Navigate to={next} replace />

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

      <Card>
        {step.kind === 'email' ? (
          <EmailStep next={next} onCodeSent={(email) => setStep({ kind: 'code', email })} />
        ) : (
          <CodeStep email={step.email} next={next} onChangeEmail={() => setStep({ kind: 'email' })} />
        )}
      </Card>
    </main>
  )
}

function EmailStep({ next, onCodeSent }: { next: string; onCodeSent: (email: string) => void }) {
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState<'google' | 'email' | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleGoogle() {
    setBusy('google')
    setError(null)
    try {
      await signInWithGoogle(next) // the browser leaves the page here
    } catch (err) {
      setError((err as Error).message)
      setBusy(null)
    }
  }

  async function handleEmail(event: FormEvent) {
    event.preventDefault()
    setBusy('email')
    setError(null)
    const trimmed = email.trim()
    try {
      await sendSignInCode(trimmed, next)
      onCodeSent(trimmed)
    } catch (err) {
      setError((err as Error).message)
      setBusy(null)
    }
  }

  return (
    <div className="space-y-5">
      <Button
        variant="secondary"
        className="w-full"
        onClick={handleGoogle}
        busy={busy === 'google'}
        disabled={busy !== null}
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
          hint="We’ll email you a sign-in code. No password needed."
        />
        <Button type="submit" className="w-full" busy={busy === 'email'} disabled={busy !== null}>
          Email me a code
        </Button>
      </form>

      {error && <Notice tone="error">{error}</Notice>}
    </div>
  )
}

function CodeStep({ email, next, onChangeEmail }: { email: string; next: string; onChangeEmail: () => void }) {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState<'verify' | 'resend' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [resent, setResent] = useState(false)

  async function handleVerify(event: FormEvent) {
    event.preventDefault()
    setBusy('verify')
    setError(null)
    try {
      // On success the session changes and SignInPage redirects.
      await verifySignInCode(email, code)
    } catch (err) {
      setError((err as Error).message)
      setBusy(null)
    }
  }

  async function handleResend() {
    setBusy('resend')
    setError(null)
    setResent(false)
    try {
      await sendSignInCode(email, next)
      setResent(true)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm">
        We sent a code to <strong>{email}</strong>. It can take a minute to arrive, so check your spam folder too.
      </p>

      <form onSubmit={handleVerify} className="space-y-3">
        <TextField
          label="Sign-in code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6,8}"
          maxLength={8}
          required
          autoFocus
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          placeholder="123456"
          className="[&_input]:text-center [&_input]:text-xl [&_input]:tracking-[0.3em]"
        />
        <Button type="submit" className="w-full" busy={busy === 'verify'} disabled={busy !== null}>
          Sign in
        </Button>
      </form>

      {resent && <Notice tone="success">New code sent. Use the most recent email.</Notice>}
      {error && <Notice tone="error">{error}</Notice>}

      <div className="flex justify-between">
        <Button variant="ghost" onClick={onChangeEmail} disabled={busy !== null}>
          Use a different email
        </Button>
        <Button variant="ghost" onClick={handleResend} busy={busy === 'resend'} disabled={busy !== null}>
          Resend code
        </Button>
      </div>
    </div>
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
