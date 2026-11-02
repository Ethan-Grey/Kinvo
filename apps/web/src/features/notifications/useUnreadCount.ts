import { createContext, useContext } from 'react'

export interface UnreadCountState {
  /** Unread notifications, or null until the first count arrives. */
  count: number | null
  /** Re-counts now, e.g. after marking notifications read. */
  refresh: () => void
}

export const UnreadCountContext = createContext<UnreadCountState | undefined>(undefined)

export function useUnreadCount(): UnreadCountState {
  const value = useContext(UnreadCountContext)
  if (!value) throw new Error('useUnreadCount must be used inside <UnreadCountProvider>')
  return value
}
