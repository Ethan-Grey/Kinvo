import { createContext, useContext } from 'react'

export interface RefreshState {
  /** Goes up by one each time the app's data should be fetched again. */
  generation: number
  /** Ask every screen to fetch fresh data (e.g. pull to refresh). */
  refresh: () => void
}

/**
 * Lets any screen's data follow live updates. Outside a provider (sign-in
 * screens, tests) nothing ever refreshes, which is what those want.
 */
export const RefreshContext = createContext<RefreshState>({ generation: 0, refresh: () => {} })

export function useRefresh(): RefreshState {
  return useContext(RefreshContext)
}
