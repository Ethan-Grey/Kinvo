import type { Session } from '@supabase/supabase-js'
import { createContext, useContext } from 'react'

export interface AuthState {
  /** Null when signed out. */
  session: Session | null
  /** True until the stored session (if any) has been loaded. */
  loading: boolean
}

export const AuthContext = createContext<AuthState | undefined>(undefined)

export function useAuth(): AuthState {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>')
  return value
}
