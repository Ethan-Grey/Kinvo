import { Link, Navigate, useSearchParams } from 'react-router'
import { safeNextPath } from '../../shared/navigation'
import { Card, FullPageSpinner, Notice } from '../../shared/ui'
import { useAuth } from './useAuth'

/**
 * Landing page after Google or a magic link. Supabase exchanges the one-time
 * code in the URL for a session automatically; this page waits for that, then
 * continues to wherever the user was heading.
 */
export function AuthCallbackPage() {
  const { session, loading } = useAuth()
  const [params] = useSearchParams()
  const next = safeNextPath(params.get('next'))
  const providerError = params.get('error_description')

  if (providerError) {
    return (
      <main className="mx-auto flex min-h-svh max-w-sm flex-col justify-center px-4">
        <Card className="space-y-4">
          <Notice tone="error">Sign-in didn’t complete: {providerError}</Notice>
          <Link to={`/sign-in?next=${encodeURIComponent(next)}`} className="text-sm font-medium text-brand-ink underline">
            Try again
          </Link>
        </Card>
      </main>
    )
  }

  if (session) return <Navigate to={next} replace />
  if (!loading) return <Navigate to={`/sign-in?next=${encodeURIComponent(next)}`} replace />
  return <FullPageSpinner label="Signing you in…" />
}
