/**
 * Signed unsubscribe tokens: "<send_id>.<base64url(HMAC-SHA256(secret, 'unsub:' + send_id))>".
 * WebCrypto only (works in Deno and Node ≥ 20), unit-tested with vitest.
 */

const enc = new TextEncoder()
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function toB64Url(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromB64Url(s: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(s)) return null
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)
  try {
    return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
  } catch {
    return null
  }
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  if (secret.length < 32) throw new Error('UNSUBSCRIBE_SIGNING_SECRET must be at least 32 characters')
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
}

export async function signUnsubscribeToken(sendId: string, secret: string): Promise<string> {
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(`unsub:${sendId}`))
  return `${sendId}.${toB64Url(new Uint8Array(sig))}`
}

/** Returns the send id when the token is authentic, otherwise null (constant-time verify). */
export async function verifyUnsubscribeToken(token: string, secret: string): Promise<string | null> {
  const [sendId, sig, extra] = token.trim().split('.')
  if (!sendId || !sig || extra !== undefined || !UUID_RE.test(sendId)) return null
  const bytes = fromB64Url(sig)
  if (!bytes || bytes.length !== 32) return null
  const ok = await crypto.subtle.verify('HMAC', await hmacKey(secret), bytes as BufferSource, enc.encode(`unsub:${sendId}`))
  return ok ? sendId.toLowerCase() : null
}
