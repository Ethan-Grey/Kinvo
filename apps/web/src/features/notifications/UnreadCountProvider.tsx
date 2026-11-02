import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useLocation } from 'react-router'
import { countUnread } from '../../data/notifications'
import { UnreadCountContext } from './useUnreadCount'

/**
 * Keeps the bell's unread count fresh without a live connection: it re-counts
 * on every page change and whenever the app comes back to the foreground
 * (the usual moment after an email or a phone unlock).
 */
export function UnreadCountProvider({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
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
  }, [pathname, version])

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [refresh])

  const value = useMemo(() => ({ count, refresh }), [count, refresh])
  return <UnreadCountContext.Provider value={value}>{children}</UnreadCountContext.Provider>
}
