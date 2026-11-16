import { describe, expect, it } from 'vitest'
import {
  buildDnsRecords,
  emailOnDomain,
  identityStatuses,
  isTransientSesError,
  mapSesStatus,
  normalizeDomain,
  sesErrorCode,
} from './sender-domain'

describe('normalizeDomain', () => {
  it('accepts and cleans common input shapes', () => {
    expect(normalizeDomain('  Mail.Example.co ')).toEqual({ domain: 'mail.example.co' })
    expect(normalizeDomain('https://www.shop.io/path?x=1')).toEqual({ domain: 'shop.io' })
    expect(normalizeDomain('hello@News.Brand.vn')).toEqual({ domain: 'news.brand.vn' })
    expect(normalizeDomain('brand.com.')).toEqual({ domain: 'brand.com' })
  })

  it('rejects invalid, free-mail and shared-hosting domains', () => {
    expect(normalizeDomain('')).toEqual({ problem: 'empty' })
    expect(normalizeDomain('not a domain')).toEqual({ problem: 'invalid' })
    expect(normalizeDomain('-bad-.com')).toEqual({ problem: 'invalid' })
    expect(normalizeDomain('gmail.com')).toEqual({ problem: 'blocked' })
    expect(normalizeDomain('vocal-babka-568f64.netlify.app')).toEqual({ problem: 'blocked' })
    expect(normalizeDomain('example.com')).toEqual({ problem: 'blocked' })
  })
})

describe('SES status mapping', () => {
  it('maps SES strings to domain_status', () => {
    expect(mapSesStatus('SUCCESS')).toBe('verified')
    expect(mapSesStatus('TEMPORARY_FAILURE')).toBe('temporary_failure')
    expect(mapSesStatus(undefined)).toBe('pending')
  })

  it('treats VerifiedForSendingStatus as verified', () => {
    expect(identityStatuses({ VerifiedForSendingStatus: true, DkimAttributes: { Status: 'SUCCESS' } })).toEqual({
      verification_status: 'verified',
      dkim_status: 'verified',
    })
    expect(identityStatuses({ VerificationStatus: 'PENDING' })).toEqual({
      verification_status: 'pending',
      dkim_status: 'pending',
    })
  })
})

describe('buildDnsRecords', () => {
  const records = buildDnsRecords('mail.aithubs.com', 'ap-northeast-1', {
    DkimAttributes: { Status: 'PENDING', Tokens: ['t1', 't2', 't3'] },
    MailFromAttributes: { MailFromDomain: 'bounce.mail.aithubs.com', MailFromDomainStatus: 'SUCCESS' },
  })

  it('returns 3 DKIM CNAMEs, MAIL FROM MX + SPF and a DMARC suggestion', () => {
    expect(records.map((r) => `${r.type} ${r.name}`)).toEqual([
      'CNAME t1._domainkey.mail.aithubs.com',
      'CNAME t2._domainkey.mail.aithubs.com',
      'CNAME t3._domainkey.mail.aithubs.com',
      'MX bounce.mail.aithubs.com',
      'TXT bounce.mail.aithubs.com',
      'TXT _dmarc.mail.aithubs.com',
    ])
    expect(records[0]).toMatchObject({ value: 't1.dkim.amazonses.com', status: 'pending', required: true })
    expect(records[3]).toMatchObject({ value: 'feedback-smtp.ap-northeast-1.amazonses.com', priority: 10, status: 'verified' })
    expect(records[5]).toMatchObject({ required: false, status: 'recommended' })
  })

  it('never puts an SPF record on the sending domain itself (root SPF stays untouched)', () => {
    const spf = records.filter((r) => r.value.startsWith('v=spf1'))
    expect(spf).toHaveLength(1)
    expect(spf[0]!.name).toBe('bounce.mail.aithubs.com')
  })
})

describe('SES errors', () => {
  it('reads the error code from header or body', () => {
    expect(sesErrorCode('AlreadyExistsException:http://internal.amazon.com/', null)).toBe('AlreadyExistsException')
    expect(sesErrorCode(null, { __type: 'com.amazonaws#NotFoundException' })).toBe('NotFoundException')
    expect(sesErrorCode(null, {})).toBe('UnknownError')
  })

  it('classifies transient errors', () => {
    expect(isTransientSesError('TooManyRequestsException', 429)).toBe(true)
    expect(isTransientSesError('InternalFailure', 500)).toBe(true)
    expect(isTransientSesError('MessageRejected', 400)).toBe(false)
  })
})

describe('emailOnDomain', () => {
  it('requires the address to be exactly on the verified domain', () => {
    expect(emailOnDomain('Hello@Mail.Aithubs.com', 'mail.aithubs.com')).toBe(true)
    expect(emailOnDomain('hello@aithubs.com', 'mail.aithubs.com')).toBe(false)
    expect(emailOnDomain('hello@evil-mail.aithubs.com', 'mail.aithubs.com')).toBe(false)
    expect(emailOnDomain('nope', 'mail.aithubs.com')).toBe(false)
  })
})
