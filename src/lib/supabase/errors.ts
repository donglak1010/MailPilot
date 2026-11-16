type DbError = { code?: string; message?: string; hint?: string | null }

const KNOWN: Record<string, string> = {
  contact_limit_reached: 'This workspace has reached its contact limit.',
  suppressed_email: 'This address is suppressed (unsubscribed, bounced or complained) and cannot be subscribed.',
  not_a_member: 'You are not a member of this workspace.',
  import_not_found: 'Import not found.',
  import_not_open: 'This import has already finished.',
  list_not_found: 'The selected list no longer exists.',
  // campaign sending (0004_campaign_sending.sql)
  campaign_not_found: 'Campaign not found.',
  not_allowed: 'Only workspace owners and admins can do this.',
  workspace_sending_disabled: 'Sending is paused for this workspace.',
  sender_not_verified: 'Choose a From address on a verified sending domain.',
  missing_subject: 'Add a subject line.',
  missing_content: 'Add the email content.',
  missing_unsubscribe_placeholder: 'The email content must contain the {{unsubscribe_url}} link.',
  missing_postal_address: 'Add your postal address in Settings — it is required in every marketing email.',
  no_audience: 'Choose at least one list to send to.',
  empty_audience: 'The selected lists have no subscribed contacts.',
  monthly_quota_insufficient: 'Not enough monthly sending quota left for this audience.',
  campaign_not_startable: 'This campaign has already been started.',
  campaign_not_schedulable: 'Only draft or scheduled campaigns can be scheduled.',
  invalid_schedule_time: 'Pick a time at least 2 minutes from now and within a year.',
  campaign_not_sending: 'This campaign is not sending.',
  campaign_not_paused: 'This campaign is not paused.',
  campaign_not_cancellable: 'This campaign can no longer be cancelled.',
}

/** User-facing text for a campaign preflight / RPC error code. */
export function knownErrorMessage(code: string): string | undefined {
  return KNOWN[code]
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
