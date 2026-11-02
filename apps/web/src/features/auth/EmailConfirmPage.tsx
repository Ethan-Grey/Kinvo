import { useEffect, useRef, useState } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router'
import { takePendingNext, verifyEmailLink } from '../../data/auth'
import { safeNextPath } from '../../shared/navigation'
import { Card, FullPageSpinner, Logo, Notice } from '../../shared/ui'

type Status = { kind: 'verifying' } | { kind: 'done'; next: string } | { kind: 'error'; message: string }

/**
 * /auth/confirm?token_hash=… — the link in the sign-in email.
 *
 * Verifies with a token hash rather than a PKCE code, so it works even when
 * the email is opened in a different browser or app from the one that asked.
 */
export function EmailConfirmPage() {
  const [params] = useSearchParams()
  const tokenHash = params.get('token_hash')
  const [status, setStatus] = useState<Status>(
    tokenHash ? { kind: 'verifying' } : { kind: 'error', message: 'This sign-in link is incomplete.' },
  )

  // Verify exactly once, even when React StrictMode runs effects twice in
  // development. A second attempt would fail because the link is single-use.
  const started = useRef(false)
  useEffect(() => {
    if (!tokenHash || started.current) return
    started.current = true
    verifyEmailLink(tokenHash).then(
      () => setStatus({ kind: 'done', next: safeNextPath(takePendingNext()) }),
      (err: Error) => setStatus({ kind: 'error', message: err.message }),
    )
  }, [tokenHash])

  if (status.kind === 'verifying') return <FullPageSpinner label="Signing you in…" />
  if (status.kind === 'done') return <Navigate to={status.next} replace />

  return (
    <main className="mx-auto flex min-h-svh max-w-sm flex-col justify-center gap-6 px-4">
      <Logo className="size-10" />
      <Card className="space-y-4">
        <Notice tone="error">{status.message}</Notice>
        <p className="text-sm text-ink-muted">If you entered the code from the email instead, you may already be signed in.</p>
        <Link to="/" className="text-sm font-medium text-brand-ink underline">
          Continue to Kinvo
        </Link>
      </Card>
    </main>
  )
}
