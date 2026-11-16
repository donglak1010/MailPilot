import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { getEnv } from '@/lib/env'

let client: SupabaseClient | undefined

/**
 * Browser Supabase client. Uses the publishable key only; all data
 * access is protected by Row Level Security in the database.
 * Generated database types are added in Phase 1.
 */
export function getSupabase(): SupabaseClient {
  if (!client) {
    const env = getEnv()
    client = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  }
  return client
}
