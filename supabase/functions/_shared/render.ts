/**
 * Merge-tag rendering for outgoing email. Pure (no Deno/npm imports): unit-tested with vitest.
 *
 * Tags: {{first_name}}, {{last_name}}, {{full_name}}, {{email}}, {{unsubscribe_url}},
 * {{postal_address}}, any custom field key ({{plan}}), with optional fallback {{first_name|there}}.
 */

export type MergeContact = {
  first_name?: string | null
  last_name?: string | null
  email?: string | null
  custom_fields?: Record<string, unknown> | null
}

export type RenderInput = {
  subject: string
  preview_text?: string | null
  html_body: string
  text_body?: string | null
  postal_address?: string | null
  contact: MergeContact
  unsubscribe_url: string
}

export type RenderedEmail = { subject: string; html: string; text: string }

const TAG_RE = /\{\{\s*([a-zA-Z0-9_.]+)\s*(?:\|([^}]*))?\}\}/g

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

function lookup(key: string, input: Omit<RenderInput, 'subject' | 'html_body' | 'text_body'>): string | undefined {
  const c = input.contact
  switch (key) {
    case 'first_name':
      return c.first_name ?? undefined
    case 'last_name':
      return c.last_name ?? undefined
    case 'full_name':
      return [c.first_name, c.last_name].filter(Boolean).join(' ') || undefined
    case 'email':
      return c.email ?? undefined
    case 'unsubscribe_url':
      return input.unsubscribe_url
    case 'postal_address':
      return input.postal_address ?? undefined
  }
  const k = key.startsWith('custom.') ? key.slice(7) : key
  const v = c.custom_fields?.[k]
  return v === null || v === undefined ? undefined : String(v)
}

type Mode = 'html' | 'text' | 'subject'

export function renderTags(template: string, input: Omit<RenderInput, 'subject' | 'html_body' | 'text_body'>, mode: Mode): string {
  return template.replace(TAG_RE, (_m, key: string, fallback: string | undefined) => {
    const raw = lookup(key, input)
    const value = raw !== undefined && raw.trim() !== '' ? raw : (fallback ?? '').trim()
    if (mode === 'subject') return value.replace(/[\r\n]+/g, ' ')
    if (mode === 'text') return value
    // URLs go into href attributes: escape but keep as-is otherwise
    if (key === 'postal_address') return escapeHtml(value).replace(/\r?\n/g, '<br>')
    return escapeHtml(value)
  })
}

/** Very small HTML → text conversion for the plain-text fallback. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|head)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<a\s[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, label: string) => {
      const text = label.replace(/<[^>]+>/g, '').trim()
      return text && text !== href ? `${text} (${href})` : href
    })
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr|table|blockquote)>/gi, '\n\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<hr[^>]*>/gi, '\n----\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Hidden inbox preview text, inserted right after <body> (or at the top). */
function withPreheader(html: string, preview: string): string {
  if (!preview.trim()) return html
  const span =
    `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:transparent">` +
    `${escapeHtml(preview)}${'&#847;&zwnj;&nbsp;'.repeat(20)}</div>`
  return /<body[^>]*>/i.test(html) ? html.replace(/<body[^>]*>/i, (m) => m + span) : span + html
}

function wrapDocument(html: string): string {
  if (/<html[\s>]/i.test(html)) return html
  return (
    '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>' +
    `<body style="margin:0;padding:16px;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;line-height:1.5;color:#111">${html}</body></html>`
  )
}

/** Render subject / HTML / text for one recipient. Guarantees an unsubscribe link in both bodies. */
export function renderEmail(input: RenderInput): RenderedEmail {
  const ctx = { contact: input.contact, unsubscribe_url: input.unsubscribe_url, postal_address: input.postal_address }
  const subject = renderTags(input.subject, ctx, 'subject').trim()
  const preview = renderTags(input.preview_text ?? '', ctx, 'subject')

  let html = renderTags(input.html_body, ctx, 'html')
  if (!input.html_body.includes('{{unsubscribe_url}}')) {
    html += `<p style="font-size:12px;color:#666"><a href="${escapeHtml(input.unsubscribe_url)}">Unsubscribe</a></p>`
  }
  html = withPreheader(wrapDocument(html), preview)

  let text = input.text_body?.trim() ? renderTags(input.text_body, ctx, 'text') : htmlToText(renderTags(input.html_body, ctx, 'html'))
  if (!text.includes(input.unsubscribe_url)) text += `\n\nUnsubscribe: ${input.unsubscribe_url}`
  if (input.postal_address?.trim() && !text.includes(input.postal_address.trim().split('\n')[0]!)) {
    text += `\n${input.postal_address.trim()}`
  }
  return { subject, html, text }
}

/** "Name" <email> with characters that would break the header removed. */
export function formatFrom(name: string | null | undefined, email: string): string {
  const clean = (name ?? '').replace(/["\r\n<>\\]/g, '').trim().slice(0, 120)
  return clean ? `"${clean}" <${email}>` : email
}
