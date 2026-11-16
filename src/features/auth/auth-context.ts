import type { Session, User } from '@supabase/supabase-js'
import { createContext, useContext } from 'react'

export type AuthState = {
  session: Session | null
  user: User | null
  /** true until Supabase reports the initial session */
  loading: boolean
  /** true after the user opened a password-recovery link */
  recovery: boolean
}

export const AuthContext = createContext<AuthState | undefined>(undefined)

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}

/** For components that only render behind <RequireAuth>. */
export function useUser(): User {
  const { user } = useAuth()
  if (!user) throw new Error('useUser called without an authenticated user')
  return user
}
