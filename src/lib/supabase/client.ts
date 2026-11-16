import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { getEnv } from '@/lib/env'
import type { Database } from '@/types/database'

export type TypedSupabaseClient = SupabaseClient<Database>

let client: TypedSupabaseClient | undefined

/**
 * Browser Supabase client. Uses the publishable key only; all data
 * access is protected by Row Level Security in the database.
 * Regenerate types after schema changes: `npm run db:types`.
 */
export function getSupabase(): TypedSupabaseClient {
  if (!client) {
    const env = getEnv()
    client = createClient<Database>(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  }
  return client
}
