import { useQuery } from '@tanstack/react-query'
import { FunctionsHttpError } from '@supabase/supabase-js'
import { getSupabase } from '@/lib/supabase/client'
import type { Enums, Tables } from '@/types/app'

export type DomainStatus = Enums<'domain_status'>

/** Mirrors supabase/functions/_shared/sender-domain.ts (stored in sender_domains.dns_records). */
export type DnsRecord = {
  type: 'CNAME' | 'MX' | 'TXT'
  name: string
  value: string
  priority?: number
  purpose: 'dkim' | 'mail_from_mx' | 'mail_from_spf' | 'dmarc'
  required: boolean
  status: DomainStatus | 'recommended'
}

export type SenderDomain = Omit<Tables<'sender_domains'>, 'dns_records'> & { dns_records: DnsRecord[] }

export type SesAccount =
  | { configured: false; reason: string }
  | {
      configured: true
      mock: boolean
      region: string
      production_access: boolean
      sending_enabled: boolean
      enforcement_status: string | null
      max_24h_send: number | null
      max_send_rate: number | null
      sent_last_24h: number | null
    }

export const senderDomainKeys = {
  all: (ws: string) => ['sender-domains', ws] as const,
  list: (ws: string) => ['sender-domains', ws, 'list'] as const,
  account: (ws: string) => ['sender-domains', ws, 'account'] as const,
}

export const isDomainVerified = (d: Pick<SenderDomain, 'verification_status' | 'dkim_status'>) =>
  d.verification_status === 'verified' && d.dkim_status === 'verified'

export function useSenderDomains(workspaceId: string) {
  return useQuery({
    queryKey: senderDomainKeys.list(workspaceId),
    queryFn: async (): Promise<SenderDomain[]> => {
      const { data, error } = await getSupabase()
        .from('sender_domains')
        .select('*')
        .eq('workspace_id', workspaceId)
        .order('created_at')
      if (error) throw error
      return data.map((d) => ({ ...d, dns_records: Array.isArray(d.dns_records) ? (d.dns_records as DnsRecord[]) : [] }))
    },
  })
}

export function useSesAccount(workspaceId: string) {
  return useQuery({
    queryKey: senderDomainKeys.account(workspaceId),
    queryFn: () => invokeSenderDomains<SesAccount>({ action: 'account', workspace_id: workspaceId }),
    staleTime: 5 * 60_000,
    retry: false,
  })
}

/** Error with the structured `{ error: { code, message } }` returned by the Edge Function. */
export class FunctionError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

export const PURPOSE_LABELS: Record<DnsRecord['purpose'], string> = {
  dkim: 'DKIM signature',
  mail_from_mx: 'Bounce handling (MAIL FROM)',
  mail_from_spf: 'SPF for MAIL FROM',
  dmarc: 'DMARC policy',
}

export async function invokeSenderDomains<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await getSupabase().functions.invoke<T>('sender-domains', { body })
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const payload = (await (error.context as Response).json().catch(() => null)) as {
        error?: { code?: string; message?: string }
      } | null
      throw new FunctionError(payload?.error?.code ?? 'error', payload?.error?.message ?? 'Request failed.')
    }
    throw new FunctionError('network', 'Could not reach the server. Check your connection and try again.')
  }
  return data as T
}

export const createDomain = (workspaceId: string, domain: string) =>
  invokeSenderDomains<SenderDomain>({ action: 'create', workspace_id: workspaceId, domain })

export const refreshDomain = (workspaceId: string, domainId: string) =>
  invokeSenderDomains<SenderDomain>({ action: 'refresh', workspace_id: workspaceId, domain_id: domainId })

export const deleteDomain = (workspaceId: string, domainId: string) =>
  invokeSenderDomains<{ deleted: true }>({ action: 'delete', workspace_id: workspaceId, domain_id: domainId })

export type SendTestInput = { domain_id: string; from_email: string; from_name?: string; reply_to?: string }

export const sendTestEmail = (workspaceId: string, input: SendTestInput) =>
  invokeSenderDomains<{ message_id: string; to: string; mock: boolean }>({
    action: 'send_test',
    workspace_id: workspaceId,
    ...input,
  })
