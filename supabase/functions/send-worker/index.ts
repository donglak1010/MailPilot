// Send worker (Phase 4). Invoked every minute by pg_cron (private.kick_worker → pg_net)
// and right after "Send now"/"Resume". Auth: `x-worker-secret` header (verify_jwt = false).
//
// One worker at a time (DB lease). Processes bounded batches from the pgmq `email_send`
// queue until the time budget is used, then exits:
//   queue_read → claim_send → (drop | defer | send via SES) → complete_send / fail_send
// A crash between SES acceptance and complete_send leaves the row in `sending`; the cron
// sweeper turns it into `ambiguous`, which is never retried automatically.
import { adminClient } from '../_shared/http.ts'
import { formatFrom, renderEmail } from '../_shared/render.ts'
import { SesError, sesFromEnv, type SesClient } from '../_shared/ses.ts'
import { signUnsubscribeToken } from '../_shared/unsubscribe-token.ts'

type QueueMessage = { msg_id: number; read_ct: number; message: { send_id?: string } | null }

type ClaimSend = {
  outcome: 'send'
  send_id: string
  workspace_id: string
  kind: 'campaign' | 'sequence'
  to_email: string
  from_name: string | null
  from_email: string
  reply_to: string | null
  subject: string
  preview_text: string | null
  html_body: string
  text_body: string | null
  postal_address: string | null
  contact: { first_name: string | null; last_name: string | null; email: string; custom_fields: Record<string, unknown> | null }
}
type Claim = ClaimSend | { outcome: 'drop' | 'defer'; reason?: string; delay?: number }

const env = (k: string, d?: string) => Deno.env.get(k)?.trim() || d
const TIME_BUDGET_MS = Number(env('WORKER_TIME_BUDGET_MS', '45000'))
const BATCH = Math.min(Number(env('WORKER_BATCH', '10')), 50)
const MAX_RATE = Math.max(Number(env('SES_MAX_SEND_RATE', '1')), 0.1) // emails per second
const MAX_ATTEMPTS = 6
const LEASE_SECONDS = 120
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Exponential backoff with jitter: 30s, 60s, 120s … capped at 1h, randomised to 50–100%. */
function backoffSeconds(attempt: number): number {
  const base = Math.min(30 * 2 ** Math.max(attempt - 1, 0), 3600)
  return Math.round(base * (0.5 + Math.random() * 0.5))
}

function timingSafeEqual(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a)
  const y = new TextEncoder().encode(b)
  let diff = x.length ^ y.length
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0)
  return diff === 0
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 })
  const secret = env('INTERNAL_WORKER_SECRET')
  if (!secret || secret.length < 32 || !timingSafeEqual(req.headers.get('x-worker-secret') ?? '', secret)) {
    return new Response('forbidden', { status: 403 })
  }
  const unsubSecret = env('UNSUBSCRIBE_SIGNING_SECRET')
  const appUrl = env('APP_BASE_URL')
  if (!unsubSecret || !appUrl) return Response.json({ error: 'UNSUBSCRIBE_SIGNING_SECRET / APP_BASE_URL missing' }, { status: 503 })
  const ses = sesFromEnv()
  if (!ses.configured) return Response.json({ skipped: 'ses_not_configured', reason: ses.reason }, { status: 503 })

  const admin = adminClient()
  const holder = crypto.randomUUID()
  const { data: gotLease, error: leaseErr } = await admin.rpc('acquire_worker_lease', {
    p_name: 'send-worker',
    p_holder: holder,
    p_seconds: Math.ceil(TIME_BUDGET_MS / 1000) + 30,
  })
  if (leaseErr) return Response.json({ error: leaseErr.message }, { status: 500 })
  if (!gotLease) return Response.json({ skipped: 'another_worker_running' })

  const stats = { sent: 0, dropped: 0, deferred: 0, failed: 0, retried: 0, ambiguous: 0 }
  const deadline = Date.now() + TIME_BUDGET_MS
  const ctx: Ctx = {
    admin,
    ses: ses.client,
    unsubSecret,
    appUrl: appUrl.replace(/\/$/, ''),
    oneClickBase: (env('PUBLIC_FUNCTIONS_URL') ?? `${env('SUPABASE_URL')}/functions/v1`).replace(/\/$/, ''),
    stats,
  }
  try {
    outer: while (Date.now() < deadline) {
      const { data: msgs, error } = await admin.rpc('queue_read', { p_qty: BATCH, p_vt_seconds: LEASE_SECONDS })
      if (error) throw error
      if (!msgs || msgs.length === 0) break
      for (const msg of msgs as QueueMessage[]) {
        if (Date.now() >= deadline) break outer // unprocessed messages reappear after their visibility timeout
        const started = Date.now()
        const sent = await processMessage(ctx, msg)
        if (sent) {
          const wait = 1000 / MAX_RATE - (Date.now() - started)
          if (wait > 0) await sleep(wait)
        }
      }
    }
  } catch (err) {
    console.error('worker loop error', err)
  } finally {
    await admin.rpc('release_worker_lease', { p_name: 'send-worker', p_holder: holder })
  }
  return Response.json(stats)
})

type Ctx = {
  admin: ReturnType<typeof adminClient>
  ses: SesClient
  unsubSecret: string
  appUrl: string
  oneClickBase: string
  stats: Record<'sent' | 'dropped' | 'deferred' | 'failed' | 'retried' | 'ambiguous', number>
}

async function queue(ctx: Ctx, fn: 'queue_delete' | 'queue_archive', msgId: number) {
  const { error } = await ctx.admin.rpc(fn, { p_msg_id: msgId })
  if (error) console.error(fn, msgId, error.message)
}

async function defer(ctx: Ctx, msgId: number, seconds: number) {
  const { error } = await ctx.admin.rpc('queue_defer', { p_msg_id: msgId, p_delay_seconds: seconds })
  if (error) console.error('queue_defer', msgId, error.message)
}

/** Returns true when an email was handed to SES (used for rate limiting). */
async function processMessage(ctx: Ctx, msg: QueueMessage): Promise<boolean> {
  const sendId = msg.message?.send_id
  if (!sendId || !UUID_RE.test(sendId)) {
    await queue(ctx, 'queue_archive', msg.msg_id)
    return false
  }

  const { data, error } = await ctx.admin.rpc('claim_send', { p_send_id: sendId, p_lease_seconds: LEASE_SECONDS })
  if (error) {
    console.error('claim_send', sendId, error.message)
    await defer(ctx, msg.msg_id, backoffSeconds(msg.read_ct))
    ctx.stats.deferred++
    return false
  }
  const claim = data as Claim

  if (claim.outcome === 'drop') {
    await queue(ctx, 'queue_delete', msg.msg_id)
    ctx.stats.dropped++
    return false
  }
  if (claim.outcome === 'defer') {
    if (claim.reason === 'locked_or_missing' && msg.read_ct > 5) {
      await queue(ctx, 'queue_archive', msg.msg_id) // row deleted (e.g. campaign removed)
    } else {
      await defer(ctx, msg.msg_id, (claim.delay ?? 60) + Math.round(Math.random() * 30))
    }
    ctx.stats.deferred++
    return false
  }

  // ---- send ----
  const token = await signUnsubscribeToken(claim.send_id, ctx.unsubSecret)
  const unsubscribeUrl = `${ctx.appUrl}/unsubscribe?t=${encodeURIComponent(token)}`
  const oneClickUrl = `${ctx.oneClickBase}/unsubscribe?t=${encodeURIComponent(token)}`
  const email = renderEmail({
    subject: claim.subject,
    preview_text: claim.preview_text,
    html_body: claim.html_body,
    text_body: claim.text_body,
    postal_address: claim.postal_address,
    contact: claim.contact,
    unsubscribe_url: unsubscribeUrl,
  })

  let messageId: string
  try {
    const res = await ctx.ses.sendEmail({
      from: formatFrom(claim.from_name, claim.from_email),
      to: [claim.to_email],
      replyTo: claim.reply_to ? [claim.reply_to] : undefined,
      subject: email.subject,
      html: email.html,
      text: email.text,
      headers: [
        { Name: 'List-Unsubscribe', Value: `<${oneClickUrl}>` },
        { Name: 'List-Unsubscribe-Post', Value: 'List-Unsubscribe=One-Click' },
      ],
      tags: [
        { Name: 'workspace_id', Value: claim.workspace_id },
        { Name: 'send_id', Value: claim.send_id },
        { Name: 'kind', Value: claim.kind },
      ],
    })
    messageId = res.MessageId
  } catch (err) {
    if (err instanceof SesError) {
      if (err.transient && msg.read_ct < MAX_ATTEMPTS) {
        await ctx.admin.rpc('fail_send', { p_send_id: claim.send_id, p_error: `${err.code}: ${err.message}`, p_permanent: false })
        await defer(ctx, msg.msg_id, backoffSeconds(msg.read_ct))
        ctx.stats.retried++
      } else {
        await ctx.admin.rpc('fail_send', { p_send_id: claim.send_id, p_error: `${err.code}: ${err.message}`, p_permanent: true })
        await queue(ctx, 'queue_delete', msg.msg_id)
        ctx.stats.failed++
      }
      return true
    }
    // Network error / timeout: SES may or may not have accepted it. Leave the row in
    // `sending`; the sweeper marks it ambiguous. Never resend blindly.
    console.error('SES call outcome unknown', claim.send_id, err)
    await queue(ctx, 'queue_archive', msg.msg_id)
    ctx.stats.ambiguous++
    return true
  }

  const { error: completeErr } = await ctx.admin.rpc('complete_send', { p_send_id: claim.send_id, p_ses_message_id: messageId })
  if (completeErr) {
    // Accepted by SES but not recorded: becomes ambiguous via the sweeper (no resend).
    console.error('complete_send failed after SES accepted', claim.send_id, messageId, completeErr.message)
    ctx.stats.ambiguous++
  } else {
    ctx.stats.sent++
  }
  await queue(ctx, 'queue_delete', msg.msg_id)
  return true
}
