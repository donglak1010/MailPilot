/**
 * Amazon SNS HTTP(S) message verification + SES event normalisation.
 * Pure WebCrypto (no npm deps) so it runs in Deno and is unit-tested with vitest.
 * https://docs.aws.amazon.com/sns/latest/dg/sns-verify-signature-of-message.html
 */

export type SnsMessage = {
  Type: 'Notification' | 'SubscriptionConfirmation' | 'UnsubscribeConfirmation'
  MessageId: string
  TopicArn: string
  Message: string
  Timestamp: string
  SignatureVersion: string
  Signature: string
  SigningCertURL: string
  Subject?: string
  Token?: string
  SubscribeURL?: string
}

export function parseSnsMessage(body: unknown): SnsMessage | null {
  if (!body || typeof body !== 'object') return null
  const m = body as Record<string, unknown>
  const str = (k: string) => typeof m[k] === 'string'
  if (!['Notification', 'SubscriptionConfirmation', 'UnsubscribeConfirmation'].includes(m.Type as string)) return null
  if (!['MessageId', 'TopicArn', 'Message', 'Timestamp', 'SignatureVersion', 'Signature', 'SigningCertURL'].every(str)) return null
  return m as unknown as SnsMessage
}

/** Only certificates served by SNS itself over HTTPS are trusted. */
export function isTrustedCertUrl(url: string): boolean {
  try {
    const u = new URL(url)
    return (
      u.protocol === 'https:' &&
      /^sns\.[a-z0-9-]+\.amazonaws\.com(\.cn)?$/.test(u.hostname) &&
      u.pathname.endsWith('.pem') &&
      !u.username &&
      !u.port
    )
  } catch {
    return false
  }
}

/** SNS canonical string-to-sign. */
export function stringToSign(m: SnsMessage): string {
  const keys =
    m.Type === 'Notification'
      ? ['Message', 'MessageId', ...(m.Subject !== undefined ? ['Subject'] : []), 'Timestamp', 'TopicArn', 'Type']
      : ['Message', 'MessageId', 'SubscribeURL', 'Timestamp', 'Token', 'TopicArn', 'Type']
  return keys.map((k) => `${k}\n${(m as Record<string, unknown>)[k] ?? ''}\n`).join('')
}

// --- minimal DER walker: Certificate → tbsCertificate → subjectPublicKeyInfo -----------

type Tlv = { tag: number; start: number; contentStart: number; end: number }

function readTlv(der: Uint8Array, pos: number): Tlv {
  const tag = der[pos]!
  let len = der[pos + 1]!
  let p = pos + 2
  if (len & 0x80) {
    const n = len & 0x7f
    if (n === 0 || n > 4) throw new Error('unsupported DER length')
    len = 0
    for (let i = 0; i < n; i++) len = (len << 8) | der[p + i]!
    p += n
  }
  const end = p + len
  if (end > der.length) throw new Error('truncated DER')
  return { tag, start: pos, contentStart: p, end }
}

function children(der: Uint8Array, parent: Tlv): Tlv[] {
  const out: Tlv[] = []
  for (let p = parent.contentStart; p < parent.end; ) {
    const t = readTlv(der, p)
    out.push(t)
    p = t.end
  }
  return out
}

export function spkiFromCertificate(der: Uint8Array): Uint8Array {
  const cert = readTlv(der, 0)
  const tbs = children(der, cert)[0]
  if (!tbs || tbs.tag !== 0x30) throw new Error('not an X.509 certificate')
  const fields = children(der, tbs)
  const offset = fields[0]?.tag === 0xa0 ? 1 : 0 // optional [0] version
  // serialNumber, signature, issuer, validity, subject, subjectPublicKeyInfo
  const spki = fields[offset + 5]
  if (!spki || spki.tag !== 0x30) throw new Error('subjectPublicKeyInfo not found')
  return der.slice(spki.start, spki.end)
}

export function pemToDer(pem: string): Uint8Array {
  const b64 = pem.replace(/-----(BEGIN|END) CERTIFICATE-----/g, '').replace(/\s+/g, '')
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
}

/**
 * Verify an SNS message signature. `fetchPem` downloads the certificate
 * (callers should cache it per URL). Returns false on any problem.
 */
export async function verifySnsSignature(m: SnsMessage, fetchPem: (url: string) => Promise<string>): Promise<boolean> {
  if (!isTrustedCertUrl(m.SigningCertURL)) return false
  const hash = m.SignatureVersion === '2' ? 'SHA-256' : m.SignatureVersion === '1' ? 'SHA-1' : null
  if (!hash) return false
  try {
    const spki = spkiFromCertificate(pemToDer(await fetchPem(m.SigningCertURL)))
    const key = await crypto.subtle.importKey('spki', spki as BufferSource, { name: 'RSASSA-PKCS1-v1_5', hash }, false, ['verify'])
    const sig = Uint8Array.from(atob(m.Signature), (c) => c.charCodeAt(0))
    return await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, sig as BufferSource, new TextEncoder().encode(stringToSign(m)))
  } catch {
    return false
  }
}

// --- SES event → record_email_event arguments ------------------------------------------

export type EmailEventType =
  | 'send' | 'delivery' | 'bounce' | 'complaint' | 'reject' | 'delivery_delay' | 'open' | 'click' | 'rendering_failure'

export type NormalizedEvent = {
  provider_event_id: string
  event_type: EmailEventType
  ses_message_id: string
  occurred_at: string
  permanent_bounce: boolean
  detail: Record<string, unknown>
}

const TYPE_MAP: Record<string, EmailEventType> = {
  Send: 'send',
  Delivery: 'delivery',
  Bounce: 'bounce',
  Complaint: 'complaint',
  Reject: 'reject',
  DeliveryDelay: 'delivery_delay',
  Open: 'open',
  Click: 'click',
  'Rendering Failure': 'rendering_failure',
  RenderingFailure: 'rendering_failure',
}

type SesEventJson = {
  eventType?: string
  notificationType?: string
  mail?: { messageId?: string; timestamp?: string }
  bounce?: { bounceType?: string; bounceSubType?: string; timestamp?: string; bouncedRecipients?: { diagnosticCode?: string }[] }
  complaint?: { complaintFeedbackType?: string; timestamp?: string }
  delivery?: { timestamp?: string }
  open?: { timestamp?: string }
  click?: { timestamp?: string; link?: string }
  deliveryDelay?: { delayType?: string; timestamp?: string }
  reject?: { reason?: string }
  failure?: { errorMessage?: string }
}

/**
 * Normalise an SES event-publishing (or legacy notification) payload. Returns null for
 * types we do not track. `snsMessageId` is the dedupe key (unique per SNS delivery).
 * Only minimal, non-identifying detail is kept (no IP addresses / user agents).
 */
export function normalizeSesEvent(messageJson: string, snsMessageId: string): NormalizedEvent | null {
  let e: SesEventJson
  try {
    e = JSON.parse(messageJson) as SesEventJson
  } catch {
    return null
  }
  const type = TYPE_MAP[e.eventType ?? e.notificationType ?? '']
  const sesMessageId = e.mail?.messageId
  if (!type || !sesMessageId) return null

  const ts =
    e.bounce?.timestamp ?? e.complaint?.timestamp ?? e.delivery?.timestamp ?? e.open?.timestamp ??
    e.click?.timestamp ?? e.deliveryDelay?.timestamp ?? e.mail?.timestamp ?? new Date().toISOString()

  const detail: Record<string, unknown> = {}
  if (e.bounce) {
    detail.bounce_type = e.bounce.bounceType
    detail.bounce_sub_type = e.bounce.bounceSubType
    const diag = e.bounce.bouncedRecipients?.[0]?.diagnosticCode
    if (diag) detail.diagnostic = diag.slice(0, 300)
  }
  if (e.complaint?.complaintFeedbackType) detail.feedback_type = e.complaint.complaintFeedbackType
  if (e.click?.link) detail.link = e.click.link.slice(0, 2000)
  if (e.deliveryDelay?.delayType) detail.delay_type = e.deliveryDelay.delayType
  if (e.reject?.reason) detail.reason = e.reject.reason.slice(0, 300)
  if (e.failure?.errorMessage) detail.error = e.failure.errorMessage.slice(0, 300)

  return {
    provider_event_id: snsMessageId,
    event_type: type,
    ses_message_id: sesMessageId,
    occurred_at: new Date(ts).toISOString(),
    permanent_bounce: type === 'bounce' && e.bounce?.bounceType === 'Permanent',
    detail,
  }
}
