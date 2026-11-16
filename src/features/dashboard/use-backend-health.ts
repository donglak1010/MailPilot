import { useQuery } from '@tanstack/react-query'
import { getEnv } from '@/lib/env'

export type BackendHealth = { ok: true; latencyMs: number } | { ok: false; error: string }

/** Pings Supabase Auth's public health endpoint to confirm the client config works. */
export function useBackendHealth() {
  return useQuery({
    queryKey: ['backend-health'],
    queryFn: async (): Promise<BackendHealth> => {
      const env = getEnv()
      const started = performance.now()
      try {
        const res = await fetch(`${env.VITE_SUPABASE_URL}/auth/v1/health`, {
          headers: { apikey: env.VITE_SUPABASE_PUBLISHABLE_KEY },
        })
        if (!res.ok) return { ok: false, error: `HTTP ${res.status}` }
        return { ok: true, latencyMs: Math.round(performance.now() - started) }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : 'Network error' }
      }
    },
    staleTime: 30_000,
    retry: false,
  })
}
