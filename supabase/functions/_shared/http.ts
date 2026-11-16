// Shared HTTP helpers for browser-facing Edge Functions.
import { createClient, type SupabaseClient, type User } from 'npm:@supabase/supabase-js@2.119.0'

const ALLOWED_ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') ?? Deno.env.get('APP_BASE_URL') ?? 'http://localhost:5173')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean)

export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') ?? ''
  const allowed =
    ALLOWED_ORIGINS.includes(origin) || /^http:\/\/(localhost|127\.0\.0\.1):5173$/.test(origin) ? origin : ALLOWED_ORIGINS[0]!
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  }
}

/** Structured error returned to the browser: `{ error: { code, message } }`. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

export function json(req: Request, status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), 'content-type': 'application/json' },
  })
}

export function adminClient(): SupabaseClient {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

/** Resolve the calling user from the `Authorization: Bearer <jwt>` header. */
export async function requireUser(req: Request, admin: SupabaseClient): Promise<User> {
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) throw new HttpError(401, 'unauthenticated', 'Sign in required.')
  const { data, error } = await admin.auth.getUser(token)
  if (error || !data.user) throw new HttpError(401, 'unauthenticated', 'Your session has expired. Sign in again.')
  return data.user
}

export type Role = 'owner' | 'admin' | 'member'

/** Membership check done server-side with the service role (RLS is bypassed, so this IS the authorization). */
export async function requireRole(admin: SupabaseClient, workspaceId: string, userId: string, roles: Role[]): Promise<Role> {
  const { data, error } = await admin
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw new HttpError(500, 'db_error', 'Could not check workspace membership.')
  if (!data) throw new HttpError(403, 'not_a_member', 'You are not a member of this workspace.')
  if (!roles.includes(data.role as Role)) {
    throw new HttpError(403, 'forbidden', 'Only workspace owners and admins can do this.')
  }
  return data.role as Role
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function requireUuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !UUID_RE.test(value)) throw new HttpError(400, 'invalid_input', `${field} must be a UUID.`)
  return value
}
