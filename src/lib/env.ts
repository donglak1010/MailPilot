import { z } from 'zod'

/**
 * Public, browser-safe configuration only.
 * Never add service-role keys, AWS credentials or AI keys here —
 * anything prefixed VITE_ is bundled into the client.
 */
const envSchema = z.object({
  VITE_SUPABASE_URL: z.url(),
  VITE_SUPABASE_PUBLISHABLE_KEY: z.string().min(20),
})

export type PublicEnv = z.infer<typeof envSchema>

export const envResult = envSchema.safeParse(import.meta.env)

export function getEnv(): PublicEnv {
  if (!envResult.success) {
    throw new Error('Missing or invalid VITE_SUPABASE_* environment variables. See .env.example.')
  }
  return envResult.data
}
