// Send a test copy of a campaign to the caller's own address (any workspace member).
// POST { workspace_id, campaign_id } with the user's JWT.
// Merge tags use the caller's profile; the unsubscribe link is a non-functional preview.
import { adminClient, corsHeaders, HttpError, json, requireRole, requireUser, requireUuid } from '../_shared/http.ts'
import { formatFrom, renderEmail } from '../_shared/render.ts'
import { emailOnDomain } from '../_shared/sender-domain.ts'
import { SesError, sesFromEnv } from '../_shared/ses.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) })
  if (req.method !== 'POST') return json(req, 405, { error: { code: 'method_not_allowed', message: 'Use POST.' } })
  try {
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
    if (!body) throw new HttpError(400, 'invalid_input', 'Expected a JSON body.')
    const admin = adminClient()
    const user = await requireUser(req, admin)
    const workspaceId = requireUuid(body.workspace_id, 'workspace_id')
    const campaignId = requireUuid(body.campaign_id, 'campaign_id')
    await requireRole(admin, workspaceId, user.id, ['owner', 'admin', 'member'])
    if (!user.email) throw new HttpError(400, 'no_email', 'Your account has no email address.')

    const ses = sesFromEnv()
    if (!ses.configured) throw new HttpError(503, 'ses_not_configured', 'Amazon SES is not configured yet.')

    const { data: c } = await admin
      .from('campaigns')
      .select('subject, preview_text, html_body, text_body, from_name, from_email, reply_to, sender:sender_domains(domain, verification_status, dkim_status)')
      .eq('id', campaignId)
      .eq('workspace_id', workspaceId)
      .maybeSingle()
    if (!c) throw new HttpError(404, 'campaign_not_found', 'Campaign not found.')
    const sender = c.sender as { domain: string; verification_status: string; dkim_status: string } | null
    if (!sender || sender.verification_status !== 'verified' || sender.dkim_status !== 'verified') {
      throw new HttpError(409, 'sender_not_verified', 'Choose a verified sending domain first.')
    }
    if (!c.from_email || !emailOnDomain(c.from_email, sender.domain)) {
      throw new HttpError(409, 'invalid_from', `The From address must end with @${sender.domain}.`)
    }
    if (!c.subject.trim() || !c.html_body.trim()) throw new HttpError(409, 'incomplete', 'Add a subject and content first.')

    const { data: ws } = await admin
      .from('workspaces')
      .select('sending_status, daily_send_limit, postal_address')
      .eq('id', workspaceId)
      .single()
    if (!ws || ws.sending_status !== 'active') throw new HttpError(403, 'sending_paused', 'Sending is paused for this workspace.')
    const today = new Date().toISOString().slice(0, 10)
    const { data: usage } = await admin
      .from('usage_records')
      .select('quantity')
      .eq('workspace_id', workspaceId)
      .eq('metric', 'emails_sent')
      .eq('usage_date', today)
      .maybeSingle()
    if ((usage?.quantity ?? 0) >= ws.daily_send_limit) throw new HttpError(429, 'daily_limit', 'Daily sending limit reached.')

    const { data: profile } = await admin.from('profiles').select('full_name').eq('id', user.id).maybeSingle()
    const nameParts = (profile?.full_name ?? '').trim().split(/\s+/).filter(Boolean)
    const appUrl = (Deno.env.get('APP_BASE_URL') ?? '').replace(/\/$/, '')
    const email = renderEmail({
      subject: c.subject,
      preview_text: c.preview_text,
      html_body: c.html_body,
      text_body: c.text_body,
      postal_address: ws.postal_address,
      contact: { first_name: nameParts[0] ?? null, last_name: nameParts.slice(1).join(' ') || null, email: user.email, custom_fields: {} },
      unsubscribe_url: `${appUrl}/unsubscribe?t=preview`,
    })

    try {
      const res = await ses.client.sendEmail({
        from: formatFrom(c.from_name, c.from_email),
        to: [user.email],
        replyTo: c.reply_to ? [c.reply_to] : undefined,
        subject: `[Test] ${email.subject}`,
        html: email.html,
        text: email.text,
        tags: [
          { Name: 'workspace_id', Value: workspaceId },
          { Name: 'kind', Value: 'test' },
        ],
      })
      await admin.rpc('increment_usage', { p_workspace_id: workspaceId, p_metric: 'emails_sent', p_qty: 1 })
      return json(req, 200, { message_id: res.MessageId, to: user.email, mock: ses.client.mock })
    } catch (err) {
      if (err instanceof SesError) throw new HttpError(err.transient ? 503 : 502, `ses_${err.code}`, `Amazon SES: ${err.message}`)
      throw err
    }
  } catch (err) {
    if (err instanceof HttpError) return json(req, err.status, { error: { code: err.code, message: err.message } })
    console.error(err)
    return json(req, 500, { error: { code: 'internal', message: 'Unexpected server error.' } })
  }
})
