import { describe, expect, it } from 'vitest'
import { formatFrom, htmlToText, renderEmail, renderTags } from './render'
import {
  isTrustedCertUrl,
  normalizeSesEvent,
  parseSnsMessage,
  spkiFromCertificate,
  stringToSign,
  verifySnsSignature,
  type SnsMessage,
} from './sns'
import { signUnsubscribeToken, verifyUnsubscribeToken } from './unsubscribe-token'

const ctx = {
  contact: { first_name: 'Lan', last_name: 'Trần', email: 'lan@example.com', custom_fields: { plan: 'Pro <VIP>' } },
  unsubscribe_url: 'https://app.test/unsubscribe?t=abc.def',
  postal_address: '1 Phố Huế\nHà Nội',
}

describe('renderTags', () => {
  it('replaces contact fields, custom fields and fallbacks', () => {
    expect(renderTags('Hi {{first_name}} {{ last_name }}', ctx, 'text')).toBe('Hi Lan Trần')
    expect(renderTags('{{plan}} / {{custom.plan}}', ctx, 'text')).toBe('Pro <VIP> / Pro <VIP>')
    expect(renderTags('Hi {{nickname|friend}}', ctx, 'text')).toBe('Hi friend')
    expect(renderTags('Hi {{first_name|friend}}', { ...ctx, contact: {} }, 'text')).toBe('Hi friend')
    expect(renderTags('{{unknown}}', ctx, 'text')).toBe('')
  })

  it('escapes values in HTML and turns postal newlines into <br>', () => {
    expect(renderTags('<b>{{plan}}</b>', ctx, 'html')).toBe('<b>Pro &lt;VIP&gt;</b>')
    expect(renderTags('{{postal_address}}', ctx, 'html')).toBe('1 Phố Huế<br>Hà Nội')
  })

  it('never lets a merge value inject a header line into the subject', () => {
    const evil = { ...ctx, contact: { first_name: 'x\r\nBcc: victim@example.com' } }
    expect(renderTags('Hi {{first_name}}', evil, 'subject')).toBe('Hi x Bcc: victim@example.com')
  })
})

describe('renderEmail', () => {
  it('renders subject, preheader, HTML and a text fallback with unsubscribe link', () => {
    const r = renderEmail({
      subject: 'Hello {{first_name}}',
      preview_text: 'Inside: {{plan}}',
      html_body: '<p>Hi {{first_name}}</p><a href="{{unsubscribe_url}}">Unsubscribe</a>',
      text_body: '',
      ...ctx,
    })
    expect(r.subject).toBe('Hello Lan')
    expect(r.html).toContain('<!doctype html>')
    expect(r.html).toContain('display:none')
    expect(r.html).toContain('Inside: Pro &lt;VIP&gt;')
    expect(r.html).toContain('href="https://app.test/unsubscribe?t=abc.def"')
    expect(r.text).toContain('Hi Lan')
    expect(r.text).toContain('https://app.test/unsubscribe?t=abc.def')
    expect(r.text).toContain('1 Phố Huế')
  })

  it('appends an unsubscribe link when the body forgot it', () => {
    const r = renderEmail({ subject: 's', html_body: '<p>x</p>', text_body: 'x', ...ctx })
    expect(r.html).toContain('Unsubscribe</a>')
    expect(r.text).toContain('Unsubscribe: https://app.test/unsubscribe?t=abc.def')
  })
})

describe('htmlToText / formatFrom', () => {
  it('keeps link targets and paragraphs', () => {
    expect(htmlToText('<p>Hi&nbsp;there</p><p><a href="https://x.test">Buy</a></p>')).toBe('Hi there\n\nBuy (https://x.test)')
  })
  it('sanitises display names', () => {
    expect(formatFrom('Shop "Best"\r\n', 'a@b.test')).toBe('"Shop Best" <a@b.test>')
    expect(formatFrom('', 'a@b.test')).toBe('a@b.test')
  })
})

describe('unsubscribe tokens', () => {
  const secret = 'x'.repeat(40)
  const id = '3f2b8c1e-1d2a-4b5c-9e8f-0a1b2c3d4e5f'

  it('round-trips and rejects tampering', async () => {
    const token = await signUnsubscribeToken(id, secret)
    expect(await verifyUnsubscribeToken(token, secret)).toBe(id)
    expect(await verifyUnsubscribeToken(token, 'y'.repeat(40))).toBeNull()
    const otherId = '00000000-1d2a-4b5c-9e8f-0a1b2c3d4e5f'
    expect(await verifyUnsubscribeToken(`${otherId}.${token.split('.')[1]}`, secret)).toBeNull()
    expect(await verifyUnsubscribeToken('garbage', secret)).toBeNull()
    expect(await verifyUnsubscribeToken(`${id}.!!!`, secret)).toBeNull()
  })

  it('refuses short secrets', async () => {
    await expect(signUnsubscribeToken(id, 'short')).rejects.toThrow()
  })
})

// --- SNS ------------------------------------------------------------------------------

function derLen(n: number): number[] {
  if (n < 0x80) return [n]
  const bytes: number[] = []
  while (n > 0) {
    bytes.unshift(n & 0xff)
    n >>= 8
  }
  return [0x80 | bytes.length, ...bytes]
}
const tlv = (tag: number, content: Uint8Array) => new Uint8Array([tag, ...derLen(content.length), ...content])
const seq = (...parts: Uint8Array[]) => tlv(0x30, concat(parts))
function concat(parts: Uint8Array[]) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}
const toB64 = (b: Uint8Array) => btoa(String.fromCharCode(...b))

/** Structurally valid (unsigned) X.509 wrapper around a public key — enough for the DER walker. */
function fakeCertPem(spki: Uint8Array): string {
  const empty = seq()
  const tbs = seq(tlv(0xa0, tlv(0x02, new Uint8Array([2]))), tlv(0x02, new Uint8Array([1])), empty, empty, empty, empty, spki)
  const cert = seq(tbs, empty, tlv(0x03, new Uint8Array([0])))
  return `-----BEGIN CERTIFICATE-----\n${toB64(cert).replace(/(.{64})/g, '$1\n')}\n-----END CERTIFICATE-----\n`
}

describe('SNS verification', () => {
  const certUrl = 'https://sns.ap-northeast-1.amazonaws.com/SimpleNotificationService-abc.pem'

  async function signed(version: '1' | '2', overrides: Partial<SnsMessage> = {}) {
    const hash = version === '2' ? 'SHA-256' : 'SHA-1'
    const keys = await crypto.subtle.generateKey(
      { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash },
      true,
      ['sign', 'verify'],
    )
    const spki = new Uint8Array(await crypto.subtle.exportKey('spki', keys.publicKey))
    const msg: SnsMessage = {
      Type: 'Notification',
      MessageId: 'sns-msg-1',
      TopicArn: 'arn:aws:sns:ap-northeast-1:123456789012:mailpilot-ses-events',
      Message: JSON.stringify({ eventType: 'Delivery', mail: { messageId: 'ses-1' } }),
      Timestamp: '2026-11-16T00:00:00.000Z',
      SignatureVersion: version,
      Signature: '',
      SigningCertURL: certUrl,
    }
    const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keys.privateKey, new TextEncoder().encode(stringToSign(msg))))
    return { msg: { ...msg, Signature: toB64(sig), ...overrides }, pem: fakeCertPem(spki), spki }
  }

  it('extracts the public key from a certificate', async () => {
    const { pem, spki } = await signed('2')
    const der = Uint8Array.from(atob(pem.replace(/-----[^-]+-----|\s/g, '')), (c) => c.charCodeAt(0))
    expect(spkiFromCertificate(der)).toEqual(spki)
  })

  it('accepts valid SignatureVersion 1 and 2 messages', async () => {
    for (const v of ['1', '2'] as const) {
      const { msg, pem } = await signed(v)
      expect(await verifySnsSignature(msg, async () => pem)).toBe(true)
    }
  })

  it('rejects tampered messages and untrusted certificate URLs', async () => {
    const { msg, pem } = await signed('2')
    expect(await verifySnsSignature({ ...msg, Message: '{"eventType":"Complaint"}' }, async () => pem)).toBe(false)
    expect(await verifySnsSignature({ ...msg, SigningCertURL: 'https://evil.test/x.pem' }, async () => pem)).toBe(false)
    expect(await verifySnsSignature({ ...msg, SignatureVersion: '3' }, async () => pem)).toBe(false)
  })

  it('validates certificate URLs and message shape', () => {
    expect(isTrustedCertUrl(certUrl)).toBe(true)
    expect(isTrustedCertUrl('http://sns.us-east-1.amazonaws.com/a.pem')).toBe(false)
    expect(isTrustedCertUrl('https://sns.us-east-1.amazonaws.com.evil.test/a.pem')).toBe(false)
    expect(isTrustedCertUrl('https://sns.us-east-1.amazonaws.com/a.txt')).toBe(false)
    expect(parseSnsMessage({ Type: 'Other' })).toBeNull()
  })
})

describe('normalizeSesEvent', () => {
  it('maps bounces, complaints and clicks with minimal detail', () => {
    const bounce = normalizeSesEvent(
      JSON.stringify({
        eventType: 'Bounce',
        mail: { messageId: 'ses-1', timestamp: '2026-11-16T01:00:00Z' },
        bounce: { bounceType: 'Permanent', bounceSubType: 'General', timestamp: '2026-11-16T01:00:05Z',
                  bouncedRecipients: [{ emailAddress: 'x@y.test', diagnosticCode: '550 no such user' }] },
      }),
      'sns-1',
    )
    expect(bounce).toEqual({
      provider_event_id: 'sns-1',
      event_type: 'bounce',
      ses_message_id: 'ses-1',
      occurred_at: '2026-11-16T01:00:05.000Z',
      permanent_bounce: true,
      detail: { bounce_type: 'Permanent', bounce_sub_type: 'General', diagnostic: '550 no such user' },
    })
    expect(normalizeSesEvent(JSON.stringify({ eventType: 'Bounce', mail: { messageId: 'a' }, bounce: { bounceType: 'Transient' } }), 's')!
      .permanent_bounce).toBe(false)
    expect(normalizeSesEvent(JSON.stringify({ notificationType: 'Complaint', mail: { messageId: 'a' }, complaint: {} }), 's')!
      .event_type).toBe('complaint')
    const click = normalizeSesEvent(
      JSON.stringify({ eventType: 'Click', mail: { messageId: 'a' }, click: { link: 'https://x.test', ipAddress: '1.2.3.4', userAgent: 'UA' } }),
      's',
    )!
    expect(click.detail).toEqual({ link: 'https://x.test' })
  })

  it('ignores unknown types and junk', () => {
    expect(normalizeSesEvent(JSON.stringify({ eventType: 'Subscription', mail: { messageId: 'a' } }), 's')).toBeNull()
    expect(normalizeSesEvent('not json', 's')).toBeNull()
    expect(normalizeSesEvent(JSON.stringify({ eventType: 'Delivery' }), 's')).toBeNull()
  })
})
