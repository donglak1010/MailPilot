/**
 * Pure sender-domain helpers shared by the `sender-domains` Edge Function.
 * No Deno / npm imports so the file is unit-tested with vitest
 * (sender-domain.test.ts) and type-checked from both runtimes.
 */

export type DomainStatus = 'pending' | 'verified' | 'failed' | 'temporary_failure' | 'not_started'

export type DnsRecordPurpose = 'dkim' | 'mail_from_mx' | 'mail_from_spf' | 'dmarc'

export type DnsRecord = {
  type: 'CNAME' | 'MX' | 'TXT'
  name: string
  value: string
  priority?: number
  purpose: DnsRecordPurpose
  required: boolean
  status: DomainStatus | 'recommended'
}

/** Subset of the SES v2 GetEmailIdentity / CreateEmailIdentity response we rely on. */
export type SesIdentity = {
  VerificationStatus?: string
  VerifiedForSendingStatus?: boolean
  DkimAttributes?: { Status?: string; Tokens?: string[]; SigningEnabled?: boolean }
  MailFromAttributes?: { MailFromDomain?: string; MailFromDomainStatus?: string; BehaviorOnMxFailure?: string }
}

export type SesAccount = {
  ProductionAccessEnabled?: boolean
  SendingEnabled?: boolean
  EnforcementStatus?: string
  SendQuota?: { Max24HourSend?: number; MaxSendRate?: number; SentLast24Hours?: number }
}

const DOMAIN_RE = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/

/** Domains a customer can never prove ownership of (or that we must not send as). */
const BLOCKED_DOMAINS = [
  'gmail.com', 'googlemail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'live.com', 'icloud.com',
  'me.com', 'aol.com', 'proton.me', 'protonmail.com', 'gmx.com', 'yandex.com', 'zoho.com', 'mail.com',
]
/** Shared hosting suffixes: nobody controls DNS of a subdomain there. */
const BLOCKED_SUFFIXES = [
  'netlify.app', 'vercel.app', 'pages.dev', 'workers.dev', 'github.io', 'herokuapp.com', 'supabase.co',
  'amazonaws.com', 'amazonses.com', 'example.com', 'example.org', 'example.net', 'localhost', 'test', 'invalid',
]

export type DomainProblem = 'empty' | 'invalid' | 'too_long' | 'blocked'

/**
 * Normalise user input ("https://Mail.Example.com/", "@example.com", "example.com.")
 * into a bare lowercase domain, or report why it is unusable.
 */
export function normalizeDomain(input: string): { domain: string } | { problem: DomainProblem } {
  let d = input.trim().toLowerCase()
  if (!d) return { problem: 'empty' }
  d = d.replace(/^[a-z][a-z0-9+.-]*:\/\//, '') // scheme
  d = d.replace(/[/?#].*$/, '') // path / query
  d = d.replace(/^.*@/, '') // "user@domain" or "@domain"
  d = d.replace(/^www\./, '').replace(/\.+$/, '')
  if (!d) return { problem: 'empty' }
  if (d.length > 253) return { problem: 'too_long' }
  if (!DOMAIN_RE.test(d)) return { problem: 'invalid' }
  if (BLOCKED_DOMAINS.includes(d)) return { problem: 'blocked' }
  if (BLOCKED_SUFFIXES.some((s) => d === s || d.endsWith(`.${s}`))) return { problem: 'blocked' }
  return { domain: d }
}

export const mailFromDomainFor = (domain: string) => `bounce.${domain}`

/** SES status strings → our `domain_status` enum. */
export function mapSesStatus(status: string | undefined): DomainStatus {
  switch (status) {
    case 'SUCCESS':
      return 'verified'
    case 'FAILED':
      return 'failed'
    case 'TEMPORARY_FAILURE':
      return 'temporary_failure'
    case 'NOT_STARTED':
      return 'not_started'
    default:
      return 'pending'
  }
}

/**
 * DNS records the customer must publish. Everything lives on the sending
 * (sub)domain, so the root domain's existing SPF / MX are never touched —
 * a domain may only have ONE SPF record, and ours goes on the MAIL FROM host.
 */
export function buildDnsRecords(domain: string, region: string, identity: SesIdentity): DnsRecord[] {
  const dkim = mapSesStatus(identity.DkimAttributes?.Status)
  const mailFrom = identity.MailFromAttributes?.MailFromDomain || mailFromDomainFor(domain)
  const mailFromStatus = mapSesStatus(identity.MailFromAttributes?.MailFromDomainStatus)
  const tokens = identity.DkimAttributes?.Tokens ?? []
  return [
    ...tokens.map<DnsRecord>((t) => ({
      type: 'CNAME',
      name: `${t}._domainkey.${domain}`,
      value: `${t}.dkim.amazonses.com`,
      purpose: 'dkim',
      required: true,
      status: dkim,
    })),
    {
      type: 'MX',
      name: mailFrom,
      value: `feedback-smtp.${region}.amazonses.com`,
      priority: 10,
      purpose: 'mail_from_mx',
      required: true,
      status: mailFromStatus,
    },
    {
      type: 'TXT',
      name: mailFrom,
      value: 'v=spf1 include:amazonses.com ~all',
      purpose: 'mail_from_spf',
      required: true,
      status: mailFromStatus,
    },
    {
      type: 'TXT',
      name: `_dmarc.${domain}`,
      value: 'v=DMARC1; p=none;',
      purpose: 'dmarc',
      required: false,
      status: 'recommended',
    },
  ]
}

/** Derived statuses we persist on `sender_domains`. */
export function identityStatuses(identity: SesIdentity) {
  const verification = identity.VerifiedForSendingStatus ? 'verified' : mapSesStatus(identity.VerificationStatus)
  return {
    verification_status: verification satisfies DomainStatus,
    dkim_status: mapSesStatus(identity.DkimAttributes?.Status),
  }
}

/** Extract the AWS error code ("AlreadyExistsException") from a SES v2 error response. */
export function sesErrorCode(headerValue: string | null, body: unknown): string {
  const fromHeader = headerValue?.split(':', 1)[0]?.trim()
  if (fromHeader) return fromHeader
  if (body && typeof body === 'object') {
    const b = body as Record<string, unknown>
    const raw = (b.__type ?? b.code ?? b.Code) as string | undefined
    if (raw) return raw.split('#').pop()!.split(':', 1)[0]!
  }
  return 'UnknownError'
}

/** Transient SES errors worth retrying later (used by the send worker in Phase 4). */
export function isTransientSesError(code: string, httpStatus: number): boolean {
  if (httpStatus >= 500 || httpStatus === 429) return true
  return ['TooManyRequestsException', 'ThrottlingException', 'LimitExceededException', 'InternalFailure', 'ServiceUnavailable'].includes(code)
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** True when `email` is a syntactically valid address on exactly `domain`. */
export function emailOnDomain(email: string, domain: string): boolean {
  const e = email.trim().toLowerCase()
  return EMAIL_RE.test(e) && e.slice(e.lastIndexOf('@') + 1) === domain
}
