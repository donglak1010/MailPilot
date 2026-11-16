// SES event ingestion via SNS HTTPS subscription (verify_jwt = false).
// Configuration set → event destination (SNS topic) → this endpoint.
//  1. Verify the SNS signature and that TopicArn == SES_EVENTS_TOPIC_ARN.
//  2. SubscriptionConfirmation: confirm via the (verified, SNS-hosted) SubscribeURL.
//  3. Notification: store raw payload in webhook_inbox (dedupe on SNS MessageId), then
//     apply it with record_email_event (idempotent). Errors return 500 so SNS retries.
import { adminClient } from '../_shared/http.ts'
import { isTrustedCertUrl, normalizeSesEvent, parseSnsMessage, verifySnsSignature } from '../_shared/sns.ts'

const certCache = new Map<string, string>()
async function fetchPem(url: string): Promise<string> {
  const cached = certCache.get(url)
  if (cached) return cached
  const res = await fetch(url)
  if (!res.ok) throw new Error(`cert fetch ${res.status}`)
  const pem = await res.text()
  certCache.set(url, pem)
  return pem
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 })
  const topicArn = Deno.env.get('SES_EVENTS_TOPIC_ARN')?.trim()
  if (!topicArn) return new Response('not configured', { status: 503 })

  const raw = await req.text()
  if (raw.length > 256 * 1024) return new Response('too large', { status: 413 })
  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    return new Response('bad request', { status: 400 })
  }
  const msg = parseSnsMessage(body)
  if (!msg) return new Response('bad request', { status: 400 })
  if (msg.TopicArn !== topicArn) return new Response('unknown topic', { status: 403 })
  if (!(await verifySnsSignature(msg, fetchPem))) return new Response('invalid signature', { status: 403 })

  if (msg.Type === 'SubscriptionConfirmation') {
    if (!msg.SubscribeURL || !isTrustedSubscribeUrl(msg.SubscribeURL)) return new Response('bad subscribe url', { status: 400 })
    const res = await fetch(msg.SubscribeURL)
    console.log('SNS subscription confirmation', res.status)
    return new Response(res.ok ? 'confirmed' : 'confirm failed', { status: res.ok ? 200 : 502 })
  }
  if (msg.Type === 'UnsubscribeConfirmation') return new Response('ok')

  const admin = adminClient()
  let payload: unknown
  try {
    payload = JSON.parse(msg.Message)
  } catch {
    payload = { raw: msg.Message.slice(0, 2000) }
  }

  const { error: insertErr } = await admin
    .from('webhook_inbox')
    .upsert({ provider: 'ses', provider_message_id: msg.MessageId, payload }, {
      onConflict: 'provider,provider_message_id',
      ignoreDuplicates: true,
    })
  if (insertErr) {
    console.error('webhook_inbox insert', insertErr.message)
    return new Response('retry', { status: 500 })
  }

  const { data: row } = await admin
    .from('webhook_inbox')
    .select('id, processed_at, attempts')
    .eq('provider', 'ses')
    .eq('provider_message_id', msg.MessageId)
    .single()
  if (!row) return new Response('retry', { status: 500 })
  if (row.processed_at) return new Response('duplicate')

  const event = normalizeSesEvent(msg.Message, msg.MessageId)
  let errorText: string | null = null
  if (event) {
    const { error } = await admin.rpc('record_email_event', {
      p_provider_event_id: event.provider_event_id,
      p_event_type: event.event_type,
      p_ses_message_id: event.ses_message_id,
      p_occurred_at: event.occurred_at,
      p_permanent_bounce: event.permanent_bounce,
      p_detail: event.detail,
    })
    if (error) errorText = error.message
  }

  await admin
    .from('webhook_inbox')
    .update(
      errorText
        ? { attempts: row.attempts + 1, last_error: errorText.slice(0, 1000) }
        : { attempts: row.attempts + 1, processed_at: new Date().toISOString(), last_error: null },
    )
    .eq('id', row.id)

  if (errorText) {
    console.error('record_email_event', errorText)
    return new Response('retry', { status: 500 })
  }
  return new Response('ok')
})

function isTrustedSubscribeUrl(url: string): boolean {
  try {
    const u = new URL(url)
    // same host rules as the signing certificate
    return isTrustedCertUrl(`https://${u.hostname}/x.pem`) && u.protocol === 'https:' && u.searchParams.get('Action') === 'ConfirmSubscription'
  } catch {
    return false
  }
}
