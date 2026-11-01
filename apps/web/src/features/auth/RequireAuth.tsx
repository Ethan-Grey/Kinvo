import { Navigate, Outlet, useLocation } from 'react-router'
import { FullPageSpinner } from '../../shared/ui'
import { useAuth } from './useAuth'

/** Route guard: sends signed-out visitors to sign in, then back to where they were going. */
export function RequireAuth() {
  const { session, loading } = useAuth()
  const location = useLocation()

  if (loading) return <FullPageSpinner />

  if (!session) {
    const next = location.pathname + location.search
    return <Navigate to={`/sign-in?next=${encodeURIComponent(next)}`} replace />
  }

  return <Outlet />
}
