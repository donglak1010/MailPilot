import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState, type ReactNode } from 'react'
import { getSupabase } from '@/lib/supabase/client'
import { AuthContext, type AuthState } from './auth-context'

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const [state, setState] = useState<AuthState>({ session: null, user: null, loading: true, recovery: false })

  useEffect(() => {
    // Fires INITIAL_SESSION immediately, then every auth change.
    const { data } = getSupabase().auth.onAuthStateChange((event, session) => {
      setState((prev) => ({
        session,
        user: session?.user ?? null,
        loading: false,
        recovery: event === 'PASSWORD_RECOVERY' ? true : event === 'SIGNED_OUT' ? false : prev.recovery,
      }))
      if (event === 'SIGNED_OUT') queryClient.clear()
    })
    return () => data.subscription.unsubscribe()
  }, [queryClient])

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>
}
