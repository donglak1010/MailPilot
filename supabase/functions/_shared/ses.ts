// Minimal Amazon SES v2 REST client for Deno Edge Functions.
// Uses aws4fetch (SigV4, ~3 KB) instead of the full AWS SDK to keep cold starts small.
import { AwsClient } from 'npm:aws4fetch@1.0.20'
import { isTransientSesError, sesErrorCode, type SesAccount, type SesIdentity } from './sender-domain.ts'

export class SesError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
  get transient() {
    return isTransientSesError(this.code, this.status)
  }
}

export type SendEmailInput = {
  from: string
  to: string[]
  replyTo?: string[]
  subject: string
  html: string
  text: string
  headers?: { Name: string; Value: string }[]
  tags?: { Name: string; Value: string }[]
}

export interface SesClient {
  readonly region: string
  readonly mock: boolean
  createIdentity(domain: string): Promise<SesIdentity>
  getIdentity(domain: string): Promise<SesIdentity>
  deleteIdentity(domain: string): Promise<void>
  putMailFrom(domain: string, mailFromDomain: string): Promise<void>
  getAccount(): Promise<SesAccount>
  sendEmail(input: SendEmailInput): Promise<{ MessageId: string }>
}

export type SesConfig =
  | { configured: false; reason: string }
  | { configured: true; client: SesClient }

/** Build the SES client from Edge Function secrets. Never throws: callers report `configured: false`. */
export function sesFromEnv(): SesConfig {
  const region = Deno.env.get('AWS_REGION')?.trim()
  const configurationSet = Deno.env.get('SES_CONFIGURATION_SET')?.trim() || undefined

  if (Deno.env.get('SES_MOCK') === 'true') {
    // Mock mode is for local development only; refuse it against a hosted project.
    const url = Deno.env.get('SUPABASE_URL') ?? ''
    if (!/kong|localhost|127\.0\.0\.1|host\.docker\.internal/.test(url)) {
      return { configured: false, reason: 'SES_MOCK is only allowed for local development' }
    }
    return { configured: true, client: new MockSes(region || 'ap-northeast-1') }
  }

  const accessKeyId = Deno.env.get('AWS_ACCESS_KEY_ID')?.trim()
  const secretAccessKey = Deno.env.get('AWS_SECRET_ACCESS_KEY')?.trim()
  if (!region || !accessKeyId || !secretAccessKey) {
    return { configured: false, reason: 'AWS_REGION, AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY are not set' }
  }
  return { configured: true, client: new AwsSes(region, accessKeyId, secretAccessKey, configurationSet) }
}

class AwsSes implements SesClient {
  readonly mock = false
  private readonly aws: AwsClient
  private readonly base: string

  constructor(
    readonly region: string,
    accessKeyId: string,
    secretAccessKey: string,
    private readonly configurationSet?: string,
  ) {
    this.aws = new AwsClient({ accessKeyId, secretAccessKey, region, service: 'ses', retries: 0 })
    this.base = `https://email.${region}.amazonaws.com/v2/email`
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.aws.fetch(`${this.base}${path}`, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await res.text()
    const json = text ? safeJson(text) : {}
    if (!res.ok) {
      const code = sesErrorCode(res.headers.get('x-amzn-errortype'), json)
      const message = (json as { message?: string; Message?: string }).message ?? (json as { Message?: string }).Message ?? code
      throw new SesError(code, res.status, message)
    }
    return json as T
  }

  createIdentity(domain: string) {
    return this.call<SesIdentity>('POST', '/identities', {
      EmailIdentity: domain,
      ...(this.configurationSet ? { ConfigurationSetName: this.configurationSet } : {}),
    })
  }

  getIdentity(domain: string) {
    return this.call<SesIdentity>('GET', `/identities/${encodeURIComponent(domain)}`)
  }

  async deleteIdentity(domain: string) {
    await this.call('DELETE', `/identities/${encodeURIComponent(domain)}`)
  }

  async putMailFrom(domain: string, mailFromDomain: string) {
    await this.call('PUT', `/identities/${encodeURIComponent(domain)}/mail-from`, {
      MailFromDomain: mailFromDomain,
      BehaviorOnMxFailure: 'USE_DEFAULT_VALUE',
    })
  }

  getAccount() {
    return this.call<SesAccount>('GET', '/account')
  }

  sendEmail(input: SendEmailInput) {
    return this.call<{ MessageId: string }>('POST', '/outbound-emails', {
      FromEmailAddress: input.from,
      Destination: { ToAddresses: input.to },
      ...(input.replyTo?.length ? { ReplyToAddresses: input.replyTo } : {}),
      Content: {
        Simple: {
          Subject: { Data: input.subject, Charset: 'UTF-8' },
          Body: { Html: { Data: input.html, Charset: 'UTF-8' }, Text: { Data: input.text, Charset: 'UTF-8' } },
          ...(input.headers?.length ? { Headers: input.headers } : {}),
        },
      },
      ...(input.tags?.length ? { EmailTags: input.tags } : {}),
      ...(this.configurationSet ? { ConfigurationSetName: this.configurationSet } : {}),
    })
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return { message: text.slice(0, 300) }
  }
}

/**
 * Local-dev stand-in (SES_MOCK=true): deterministic DKIM tokens, every identity
 * reports verified on refresh, sends return a fake MessageId. No network calls.
 */
class MockSes implements SesClient {
  readonly mock = true
  constructor(readonly region: string) {}

  private async tokens(domain: string) {
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(domain)))
    const hex = [...digest].map((b) => b.toString(16).padStart(2, '0')).join('')
    return [hex.slice(0, 32), hex.slice(16, 48), hex.slice(32, 64)]
  }

  async createIdentity(domain: string): Promise<SesIdentity> {
    return {
      VerificationStatus: 'PENDING',
      VerifiedForSendingStatus: false,
      DkimAttributes: { Status: 'PENDING', Tokens: await this.tokens(domain), SigningEnabled: true },
    }
  }

  async getIdentity(domain: string): Promise<SesIdentity> {
    return {
      VerificationStatus: 'SUCCESS',
      VerifiedForSendingStatus: true,
      DkimAttributes: { Status: 'SUCCESS', Tokens: await this.tokens(domain), SigningEnabled: true },
      MailFromAttributes: { MailFromDomain: `bounce.${domain}`, MailFromDomainStatus: 'SUCCESS' },
    }
  }

  async deleteIdentity() {}
  async putMailFrom() {}

  getAccount(): Promise<SesAccount> {
    return Promise.resolve({
      ProductionAccessEnabled: false,
      SendingEnabled: true,
      EnforcementStatus: 'HEALTHY',
      SendQuota: { Max24HourSend: 200, MaxSendRate: 1, SentLast24Hours: 0 },
    })
  }

  sendEmail(): Promise<{ MessageId: string }> {
    return Promise.resolve({ MessageId: `mock-${crypto.randomUUID()}` })
  }
}
