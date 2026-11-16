// Public unsubscribe endpoint (verify_jwt = false).
//   POST ?t=<token>   RFC 8058 one-click (mail clients send "List-Unsubscribe=One-Click")
//   POST {token}      from the app's /unsubscribe page
//   GET  ?t=<token>   never mutates (link scanners prefetch URLs) → redirects to the app page
import { adminClient, corsHeaders } from '../_shared/http.ts'
import { verifyUnsubscribeToken } from '../_shared/unsubscribe-token.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) })
  const url = new URL(req.url)
  const appUrl = (Deno.env.get('APP_BASE_URL') ?? '').replace(/\/$/, '')
  const secret = Deno.env.get('UNSUBSCRIBE_SIGNING_SECRET') ?? ''
  const reply = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(req), 'content-type': 'application/json' } })

  if (req.method === 'GET') {
    const t = url.searchParams.get('t') ?? ''
    return new Response(null, { status: 302, headers: { location: `${appUrl}/unsubscribe?t=${encodeURIComponent(t)}` } })
  }
  if (req.method !== 'POST') return reply(405, { error: { code: 'method_not_allowed', message: 'Use POST.' } })
  if (secret.length < 32) return reply(503, { error: { code: 'not_configured', message: 'Unsubscribe is not configured.' } })

  let token = url.searchParams.get('t') ?? ''
  let source = 'link'
  const contentType = req.headers.get('content-type') ?? ''
  const raw = await req.text()
  if (contentType.includes('application/json')) {
    try {
      token = String((JSON.parse(raw) as { token?: string }).token ?? token)
    } catch {
      /* ignore */
    }
  } else if (/List-Unsubscribe=One-Click/i.test(raw)) {
    source = 'one-click'
  }

  const sendId = await verifyUnsubscribeToken(token, secret)
  if (!sendId) return reply(400, { error: { code: 'invalid_token', message: 'This unsubscribe link is invalid or incomplete.' } })

  const admin = adminClient()
  const { data: ok, error } = await admin.rpc('unsubscribe_send', { p_send_id: sendId, p_source: source })
  if (error) {
    console.error('unsubscribe_send', error.message)
    return reply(500, { error: { code: 'internal', message: 'Could not unsubscribe right now. Please try again.' } })
  }
  if (!ok) return reply(404, { error: { code: 'not_found', message: 'This email could not be found. You may already be unsubscribed.' } })

  const { data: info } = await admin
    .from('email_sends')
    .select('workspace:workspaces(name)')
    .eq('id', sendId)
    .maybeSingle()
  const sender = (info?.workspace as { name?: string } | null)?.name ?? null
  return reply(200, { unsubscribed: true, sender })
})
