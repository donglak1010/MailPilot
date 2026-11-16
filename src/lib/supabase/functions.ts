import { FunctionsHttpError } from '@supabase/supabase-js'
import { getSupabase } from './client'

/** Error with the structured `{ error: { code, message } }` returned by our Edge Functions. */
export class FunctionError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

/** Invoke an Edge Function and unwrap its structured error body. */
export async function invokeFunction<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await getSupabase().functions.invoke<T>(name, { body })
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const payload = (await (error.context as Response).json().catch(() => null)) as {
        error?: { code?: string; message?: string }
      } | null
      throw new FunctionError(payload?.error?.code ?? 'error', payload?.error?.message ?? 'Request failed.')
    }
    throw new FunctionError('network', 'Could not reach the server. Check your connection and try again.')
  }
  return data as T
}
