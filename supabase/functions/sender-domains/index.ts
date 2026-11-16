// Sender-domain onboarding (Phase 3).
//
// POST { action, ... } with the user's JWT:
//   account    { workspace_id }                       any member  → SES sandbox / quota summary
//   create     { workspace_id, domain }               owner/admin → SES identity + DNS records
//   refresh    { workspace_id, domain_id }            any member  → re-read SES verification status
//   delete     { workspace_id, domain_id }            owner/admin → delete SES identity + row
//   send_test  { workspace_id, domain_id, from_email,
//                from_name?, reply_to? }              owner/admin → test email to the caller's own address
//
// Writes to `sender_domains` happen only here (service role); clients can only read them via RLS.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.119.0'
import { adminClient, corsHeaders, HttpError, json, requireRole, requireUser, requireUuid } from '../_shared/http.ts'
import { SesError, sesFromEnv, type SesClient } from '../_shared/ses.ts'
import {
  buildDnsRecords,
  EMAIL_RE,
  emailOnDomain,
  identityStatuses,
  mailFromDomainFor,
  normalizeDomain,
  type SesIdentity,
} from '../_shared/sender-domain.ts'

type Body = Record<string, unknown>

const DOMAIN_PROBLEMS: Record<string, string> = {
  empty: 'Enter a domain such as mail.yourbrand.com.',
  invalid: 'That does not look like a valid domain name.',
  too_long: 'Domain name is too long.',
  blocked: 'You cannot send from this domain. Use a domain (or subdomain) whose DNS you control.',
}

const MAX_DOMAINS_PER_WORKSPACE = 5

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) })
  if (req.method !== 'POST') return json(req, 405, { error: { code: 'method_not_allowed', message: 'Use POST.' } })

  try {
    const body = (await req.json().catch(() => null)) as Body | null
    if (!body || typeof body !== 'object') throw new HttpError(400, 'invalid_input', 'Expected a JSON body.')

    const admin = adminClient()
    const user = await requireUser(req, admin)
    const workspaceId = requireUuid(body.workspace_id, 'workspace_id')
    const action = String(body.action ?? '')

    const ses = sesFromEnv()
    if (action === 'account') {
      await requireRole(admin, workspaceId, user.id, ['owner', 'admin', 'member'])
      if (!ses.configured) return json(req, 200, { configured: false, reason: ses.reason })
      return json(req, 200, await account(ses.client))
    }
    if (!ses.configured) {
      throw new HttpError(503, 'ses_not_configured', 'Amazon SES is not configured yet. Ask the administrator to add the AWS secrets.')
    }

    switch (action) {
      case 'create':
        await requireRole(admin, workspaceId, user.id, ['owner', 'admin'])
        return json(req, 200, await createDomain(admin, ses.client, workspaceId, body.domain))
      case 'refresh':
        await requireRole(admin, workspaceId, user.id, ['owner', 'admin', 'member'])
        return json(req, 200, await refreshDomain(admin, ses.client, workspaceId, requireUuid(body.domain_id, 'domain_id')))
      case 'delete':
        await requireRole(admin, workspaceId, user.id, ['owner', 'admin'])
        return json(req, 200, await deleteDomain(admin, ses.client, workspaceId, requireUuid(body.domain_id, 'domain_id')))
      case 'send_test':
        await requireRole(admin, workspaceId, user.id, ['owner', 'admin'])
        if (!user.email) throw new HttpError(400, 'no_email', 'Your account has no email address.')
        return json(req, 200, await sendTest(admin, ses.client, workspaceId, user.email, body))
      default:
        throw new HttpError(400, 'unknown_action', 'Unknown action.')
    }
  } catch (err) {
    if (err instanceof HttpError) return json(req, err.status, { error: { code: err.code, message: err.message } })
    if (err instanceof SesError) {
      console.error('SES error', err.code, err.status, err.message)
      const status = err.transient ? 503 : 502
      return json(req, status, { error: { code: `ses_${err.code}`, message: `Amazon SES: ${err.message}` } })
    }
    console.error('Unhandled error', err)
    return json(req, 500, { error: { code: 'internal', message: 'Unexpected server error.' } })
  }
})

// ---------------------------------------------------------------------------

async function account(ses: SesClient) {
  const a = await ses.getAccount()
  return {
    configured: true,
    mock: ses.mock,
    region: ses.region,
    production_access: a.ProductionAccessEnabled ?? false,
    sending_enabled: a.SendingEnabled ?? false,
    enforcement_status: a.EnforcementStatus ?? null,
    max_24h_send: a.SendQuota?.Max24HourSend ?? null,
    max_send_rate: a.SendQuota?.MaxSendRate ?? null,
    sent_last_24h: a.SendQuota?.SentLast24Hours ?? null,
  }
}

async function loadDomain(admin: SupabaseClient, workspaceId: string, domainId: string) {
  const { data, error } = await admin
    .from('sender_domains')
    .select('*')
    .eq('id', domainId)
    .eq('workspace_id', workspaceId)
    .maybeSingle()
  if (error) throw new HttpError(500, 'db_error', 'Could not load the domain.')
  if (!data) throw new HttpError(404, 'domain_not_found', 'Domain not found.')
  return data as { id: string; domain: string; aws_region: string; verified_at: string | null }
}

async function saveIdentity(
  admin: SupabaseClient,
  row: { id: string; domain: string; aws_region: string; verified_at: string | null },
  identity: SesIdentity,
) {
  const statuses = identityStatuses(identity)
  const verified = statuses.verification_status === 'verified' && statuses.dkim_status === 'verified'
  const { data, error } = await admin
    .from('sender_domains')
    .update({
      ...statuses,
      dns_records: buildDnsRecords(row.domain, row.aws_region, identity),
      mail_from_domain: identity.MailFromAttributes?.MailFromDomain || mailFromDomainFor(row.domain),
      last_checked_at: new Date().toISOString(),
      verified_at: verified ? (row.verified_at ?? new Date().toISOString()) : null,
    })
    .eq('id', row.id)
    .select('*')
    .single()
  if (error) throw new HttpError(500, 'db_error', 'Could not save the domain status.')
  return data
}

async function createDomain(admin: SupabaseClient, ses: SesClient, workspaceId: string, rawDomain: unknown) {
  const parsed = normalizeDomain(typeof rawDomain === 'string' ? rawDomain : '')
  if ('problem' in parsed) throw new HttpError(400, `domain_${parsed.problem}`, DOMAIN_PROBLEMS[parsed.problem]!)
  const domain = parsed.domain

  const { data: existing, error: existingErr } = await admin
    .from('sender_domains')
    .select('id, workspace_id')
    .eq('domain', domain)
    .maybeSingle()
  if (existingErr) throw new HttpError(500, 'db_error', 'Could not check the domain.')
  if (existing && existing.workspace_id !== workspaceId) {
    throw new HttpError(409, 'domain_taken', 'This domain is already connected to another workspace.')
  }
  if (existing) return refreshDomain(admin, ses, workspaceId, existing.id)

  const { count } = await admin
    .from('sender_domains')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId)
  if ((count ?? 0) >= MAX_DOMAINS_PER_WORKSPACE) {
    throw new HttpError(409, 'domain_limit', `A workspace can have at most ${MAX_DOMAINS_PER_WORKSPACE} sender domains.`)
  }

  // Claim the domain first: the unique constraint is the global lock.
  const { data: row, error: insertErr } = await admin
    .from('sender_domains')
    .insert({ workspace_id: workspaceId, domain, aws_region: ses.region, mail_from_domain: mailFromDomainFor(domain) })
    .select('id, domain, aws_region, verified_at')
    .single()
  if (insertErr) {
    if (insertErr.code === '23505') throw new HttpError(409, 'domain_taken', 'This domain is already connected to another workspace.')
    throw new HttpError(500, 'db_error', 'Could not save the domain.')
  }

  try {
    let identity: SesIdentity
    try {
      identity = await ses.createIdentity(domain)
    } catch (err) {
      // An identity without a row is an orphan (e.g. a failed delete). Recreate it so
      // ownership must be proven again via fresh DKIM records — never adopt it.
      if (!(err instanceof SesError) || err.code !== 'AlreadyExistsException') throw err
      await ses.deleteIdentity(domain)
      identity = await ses.createIdentity(domain)
    }
    try {
      await ses.putMailFrom(domain, mailFromDomainFor(domain))
      identity = { ...identity, MailFromAttributes: { MailFromDomain: mailFromDomainFor(domain), MailFromDomainStatus: 'PENDING' } }
    } catch (err) {
      console.error('MAIL FROM setup failed (non-fatal)', err)
    }
    return await saveIdentity(admin, row, identity)
  } catch (err) {
    await admin.from('sender_domains').delete().eq('id', row.id)
    throw err
  }
}

async function refreshDomain(admin: SupabaseClient, ses: SesClient, workspaceId: string, domainId: string) {
  const row = await loadDomain(admin, workspaceId, domainId)
  let identity: SesIdentity
  try {
    identity = await ses.getIdentity(row.domain)
  } catch (err) {
    if (err instanceof SesError && err.code === 'NotFoundException') {
      throw new HttpError(409, 'identity_missing', 'This domain no longer exists in Amazon SES. Delete it and add it again.')
    }
    throw err
  }
  return saveIdentity(admin, row, identity)
}

async function deleteDomain(admin: SupabaseClient, ses: SesClient, workspaceId: string, domainId: string) {
  const row = await loadDomain(admin, workspaceId, domainId)
  for (const table of ['campaigns', 'sequences'] as const) {
    const { count, error } = await admin
      .from(table)
      .select('id', { count: 'exact', head: true })
      .eq('sender_domain_id', row.id)
    if (error) throw new HttpError(500, 'db_error', 'Could not check where the domain is used.')
    if ((count ?? 0) > 0) {
      throw new HttpError(409, 'domain_in_use', 'Campaigns or sequences still use this domain. Change their sender first.')
    }
  }
  try {
    await ses.deleteIdentity(row.domain)
  } catch (err) {
    if (!(err instanceof SesError) || err.code !== 'NotFoundException') throw err
  }
  const { error } = await admin.from('sender_domains').delete().eq('id', row.id)
  if (error) throw new HttpError(500, 'db_error', 'The SES identity was removed but the domain row could not be deleted. Try again.')
  return { deleted: true }
}

async function sendTest(admin: SupabaseClient, ses: SesClient, workspaceId: string, toEmail: string, body: Body) {
  const row = await loadDomain(admin, workspaceId, requireUuid(body.domain_id, 'domain_id'))
  const { data: d } = await admin
    .from('sender_domains')
    .select('verification_status, dkim_status')
    .eq('id', row.id)
    .single()
  if (d?.verification_status !== 'verified' || d?.dkim_status !== 'verified') {
    throw new HttpError(409, 'domain_not_verified', 'Verify the domain (and DKIM) before sending.')
  }

  const fromEmail = String(body.from_email ?? '').trim().toLowerCase()
  if (!emailOnDomain(fromEmail, row.domain)) {
    throw new HttpError(400, 'invalid_from', `The From address must end with @${row.domain}.`)
  }
  const fromName = String(body.from_name ?? '').replace(/["\r\n<>]/g, '').trim().slice(0, 120)
  const replyTo = String(body.reply_to ?? '').trim()
  if (replyTo && !EMAIL_RE.test(replyTo)) throw new HttpError(400, 'invalid_reply_to', 'Reply-To is not a valid email address.')

  const { data: ws, error: wsErr } = await admin
    .from('workspaces')
    .select('name, sending_status, daily_send_limit')
    .eq('id', workspaceId)
    .single()
  if (wsErr || !ws) throw new HttpError(500, 'db_error', 'Could not load the workspace.')
  if (ws.sending_status !== 'active') throw new HttpError(403, 'sending_paused', 'Sending is paused for this workspace.')

  const today = new Date().toISOString().slice(0, 10)
  const { data: usage } = await admin
    .from('usage_records')
    .select('quantity')
    .eq('workspace_id', workspaceId)
    .eq('metric', 'emails_sent')
    .eq('usage_date', today)
    .maybeSingle()
  if ((usage?.quantity ?? 0) >= ws.daily_send_limit) {
    throw new HttpError(429, 'daily_limit', 'The daily sending limit for this workspace has been reached.')
  }

  const from = fromName ? `"${fromName}" <${fromEmail}>` : fromEmail
  const sentAt = new Date().toISOString()
  const result = await ses.sendEmail({
    from,
    to: [toEmail],
    replyTo: replyTo ? [replyTo] : undefined,
    subject: `MailPilot test email from ${row.domain}`,
    text: [
      `This is a test email sent by MailPilot for the workspace "${ws.name}".`,
      ``,
      `From: ${from}`,
      `Sending domain: ${row.domain} (${row.aws_region})`,
      `Sent at: ${sentAt}`,
      ``,
      `If you received this, Amazon SES can send as ${row.domain}.`,
    ].join('\n'),
    html: `<!doctype html><html><body style="font-family:system-ui,sans-serif;line-height:1.5;color:#111">
<p>This is a test email sent by <strong>MailPilot</strong> for the workspace “${escapeHtml(ws.name)}”.</p>
<ul><li>From: ${escapeHtml(from)}</li><li>Sending domain: ${escapeHtml(row.domain)} (${escapeHtml(row.aws_region)})</li><li>Sent at: ${sentAt}</li></ul>
<p>If you received this, Amazon SES can send as ${escapeHtml(row.domain)}.</p></body></html>`,
    tags: [
      { Name: 'workspace_id', Value: workspaceId },
      { Name: 'kind', Value: 'test' },
    ],
  })

  await admin.rpc('increment_usage', { p_workspace_id: workspaceId, p_metric: 'emails_sent', p_qty: 1 })
  return { message_id: result.MessageId, to: toEmail, mock: ses.mock }
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}
