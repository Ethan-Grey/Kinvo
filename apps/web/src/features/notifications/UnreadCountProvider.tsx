import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useLocation } from 'react-router'
import { countUnread } from '../../data/notifications'
import { useRefresh } from '../../shared/refresh'
import { UnreadCountContext } from './useUnreadCount'

/**
 * Keeps the Alerts badge fresh: it re-counts on every page change and on
 * every app-wide refresh (a live update, the app reopening, pull to refresh).
 */
export function UnreadCountProvider({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  const { generation } = useRefresh()
  const [count, setCount] = useState<number | null>(null)
  const [version, setVersion] = useState(0)
  const refresh = useCallback(() => setVersion((v) => v + 1), [])

  useEffect(() => {
    let cancelled = false
    // A failed count just leaves the last known number; it isn't worth an error screen.
    countUnread().then(
      (n) => {
        if (!cancelled) setCount(n)
      },
      () => {},
    )
    return () => {
      cancelled = true
    }
  }, [pathname, version, generation])

  const value = useMemo(() => ({ count, refresh }), [count, refresh])
  return <UnreadCountContext.Provider value={value}>{children}</UnreadCountContext.Provider>
}
