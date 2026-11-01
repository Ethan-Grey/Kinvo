import { useEffect, useState, type ReactNode } from 'react'
import { supabase } from '../../data/supabase'
import { AuthContext, type AuthState } from './useAuth'

/**
 * Keeps the current session in React state and updates it whenever Supabase
 * signs the user in or out (including in another tab).
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ session: null, loading: true })

  useEffect(() => {
    const client = supabase()

    void client.auth.getSession().then(({ data }) => {
      setState({ session: data.session, loading: false })
    })

    const { data: subscription } = client.auth.onAuthStateChange((_event, session) => {
      setState({ session, loading: false })
    })
    return () => subscription.subscription.unsubscribe()
  }, [])

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>
}
