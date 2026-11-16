type DbError = { code?: string; message?: string; hint?: string | null }

const KNOWN: Record<string, string> = {
  contact_limit_reached: 'This workspace has reached its contact limit.',
  suppressed_email: 'This address is suppressed (unsubscribed, bounced or complained) and cannot be subscribed.',
  not_a_member: 'You are not a member of this workspace.',
  import_not_found: 'Import not found.',
  import_not_open: 'This import has already finished.',
  list_not_found: 'The selected list no longer exists.',
}

/** Turn a PostgREST/Postgres error into a short, user-safe message. */
export function dbErrorMessage(error: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (!error || typeof error !== 'object') return fallback
  const e = error as DbError
  if (e.hint && KNOWN[e.hint]) return KNOWN[e.hint]!
  const firstToken = e.message?.split(/[:\s]/, 1)[0] ?? ''
  if (KNOWN[firstToken]) return KNOWN[firstToken]!
  switch (e.code) {
    case '23505':
      return 'A record with the same value already exists.'
    case '23514':
      return 'Some values are not allowed. Check the form and try again.'
    case '42501':
      return 'You do not have permission to do this.'
    case 'PGRST116':
      return 'Record not found.'
  }
  return e.message && e.message.length < 200 ? e.message : fallback
}
