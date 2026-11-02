import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { supabase } from '../../data/supabase'
import { RefreshContext } from '../../shared/refresh'
import { useAuth } from '../auth/useAuth'

/** While the app is open, fetch again at least this often in case a live update was missed. */
const FALLBACK_POLL_MS = 60_000

/**
 * Keeps every screen up to date without reopening the app:
 *
 * - **Live:** listens over Supabase Realtime for new notifications for this
 *   person. Every loan event notifies the other person (ADR-0013), so a new
 *   notification means "something changed, fetch again".
 * - **Coming back:** refreshes when the app returns to the foreground.
 * - **Fallback:** refreshes every minute while visible, in case the live
 *   connection dropped (phones pause it in the background).
 * - **By hand:** pull to refresh calls `refresh()`.
 */
export function LiveUpdates({ children }: { children: ReactNode }) {
  const { session } = useAuth()
  const userId = session?.user.id
  const [generation, setGeneration] = useState(0)
  const refresh = useCallback(() => setGeneration((g) => g + 1), [])

  useEffect(() => {
    if (!userId) return
    const client = supabase()
    const channel = client
      .channel(`notifications:${userId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `recipient_id=eq.${userId}` },
        refresh,
      )
      .subscribe()
    return () => {
      void client.removeChannel(channel)
    }
  }, [userId, refresh])

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    document.addEventListener('visibilitychange', onVisible)
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') refresh()
    }, FALLBACK_POLL_MS)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.clearInterval(timer)
    }
  }, [refresh])

  const value = useMemo(() => ({ generation, refresh }), [generation, refresh])
  return <RefreshContext.Provider value={value}>{children}</RefreshContext.Provider>
}
