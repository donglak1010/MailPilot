import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { getSupabase } from '@/lib/supabase/client'
import { invokeFunction } from '@/lib/supabase/functions'
import type { Enums, Tables } from '@/types/app'
import type { Database } from '@/types/database'

export type CampaignStatus = Enums<'campaign_status'>
export type SendStatus = Enums<'send_status'>
export type Campaign = Tables<'campaigns'>
export type CampaignStats = Database['public']['Views']['campaign_stats']['Row']
export type EmailTemplate = Tables<'email_templates'>

export type CampaignListItem = Campaign & {
  lists: { id: string; name: string }[]
  stats: CampaignStats | null
}

export type CampaignDetail = Campaign & { list_ids: string[] }

export const campaignKeys = {
  all: (ws: string) => ['campaigns', ws] as const,
  list: (ws: string) => ['campaigns', ws, 'list'] as const,
  detail: (ws: string, id: string) => ['campaigns', ws, 'detail', id] as const,
  stats: (ws: string, id: string) => ['campaigns', ws, 'stats', id] as const,
  sends: (ws: string, id: string, status: string, page: number) => ['campaigns', ws, 'sends', id, status, page] as const,
  audience: (ws: string, listIds: string[]) => ['campaigns', ws, 'audience', [...listIds].sort().join(',')] as const,
  templates: (ws: string) => ['templates', ws] as const,
}

/** Campaign content can only change in these states (mirrors the DB guard). */
export const isEditable = (status: CampaignStatus) => status === 'draft' || status === 'scheduled' || status === 'failed'

export function useCampaigns(workspaceId: string) {
  return useQuery({
    queryKey: campaignKeys.list(workspaceId),
    queryFn: async (): Promise<CampaignListItem[]> => {
      const db = getSupabase()
      const [campaigns, stats] = await Promise.all([
        db
          .from('campaigns')
          .select('*, list_links:campaign_lists(list:contact_lists(id, name))')
          .eq('workspace_id', workspaceId)
          .order('created_at', { ascending: false })
          .limit(200),
        db.from('campaign_stats').select('*').eq('workspace_id', workspaceId),
      ])
      if (campaigns.error) throw campaigns.error
      if (stats.error) throw stats.error
      const byId = new Map(stats.data.map((s) => [s.campaign_id, s]))
      return campaigns.data.map(({ list_links, ...c }) => ({
        ...c,
        lists: (list_links as { list: { id: string; name: string } | null }[]).flatMap((l) => (l.list ? [l.list] : [])),
        stats: byId.get(c.id) ?? null,
      }))
    },
    refetchInterval: (q) => (q.state.data?.some((c) => c.status === 'sending') ? 5000 : false),
  })
}

export function useCampaign(workspaceId: string, id: string) {
  return useQuery({
    queryKey: campaignKeys.detail(workspaceId, id),
    queryFn: async (): Promise<CampaignDetail> => {
      const { data, error } = await getSupabase()
        .from('campaigns')
        .select('*, campaign_lists(list_id)')
        .eq('id', id)
        .eq('workspace_id', workspaceId)
        .single()
      if (error) throw error
      const { campaign_lists, ...c } = data
      return { ...c, list_ids: (campaign_lists as { list_id: string }[]).map((l) => l.list_id) }
    },
    refetchInterval: (q) => (q.state.data?.status === 'sending' ? 5000 : false),
  })
}

export function useCampaignStats(workspaceId: string, id: string, live: boolean) {
  return useQuery({
    queryKey: campaignKeys.stats(workspaceId, id),
    queryFn: async () => {
      const { data, error } = await getSupabase().from('campaign_stats').select('*').eq('campaign_id', id).maybeSingle()
      if (error) throw error
      return data
    },
    refetchInterval: live ? 5000 : false,
  })
}

export const SENDS_PAGE_SIZE = 50

export type SendRow = Pick<
  Tables<'email_sends'>,
  'id' | 'to_email' | 'status' | 'sent_at' | 'delivered_at' | 'opened_at' | 'clicked_at' | 'last_error' | 'unsubscribed_at'
>

export function useCampaignSends(workspaceId: string, id: string, status: SendStatus | 'all', page: number, live: boolean) {
  return useQuery({
    queryKey: campaignKeys.sends(workspaceId, id, status, page),
    queryFn: async () => {
      let q = getSupabase()
        .from('email_sends')
        .select('id, to_email, status, sent_at, delivered_at, opened_at, clicked_at, last_error, unsubscribed_at', { count: 'exact' })
        .eq('campaign_id', id)
        .eq('workspace_id', workspaceId)
        .order('created_at')
        .range(page * SENDS_PAGE_SIZE, page * SENDS_PAGE_SIZE + SENDS_PAGE_SIZE - 1)
      if (status !== 'all') q = q.eq('status', status)
      const { data, error, count } = await q
      if (error) throw error
      return { rows: data as SendRow[], total: count ?? 0 }
    },
    placeholderData: keepPreviousData,
    refetchInterval: live ? 5000 : false,
  })
}

export function useAudienceCount(workspaceId: string, listIds: string[]) {
  return useQuery({
    queryKey: campaignKeys.audience(workspaceId, listIds),
    queryFn: async () => {
      if (listIds.length === 0) return 0
      const { data, error } = await getSupabase().rpc('audience_count', { p_workspace_id: workspaceId, p_list_ids: listIds })
      if (error) throw error
      return data
    },
    placeholderData: keepPreviousData,
  })
}

export function useTemplates(workspaceId: string) {
  return useQuery({
    queryKey: campaignKeys.templates(workspaceId),
    queryFn: async () => {
      const { data, error } = await getSupabase()
        .from('email_templates')
        .select('*')
        .or(`workspace_id.is.null,workspace_id.eq.${workspaceId}`)
        .order('workspace_id', { nullsFirst: true })
        .order('name')
      if (error) throw error
      return data
    },
    staleTime: 5 * 60_000,
  })
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export type CampaignDraft = Pick<
  Campaign,
  'name' | 'subject' | 'preview_text' | 'from_name' | 'from_email' | 'reply_to' | 'sender_domain_id' | 'html_body' | 'text_body' | 'template_id'
> & { list_ids: string[] }

export async function createCampaign(
  workspaceId: string,
  userId: string,
  init: Partial<CampaignDraft> & { name: string },
): Promise<string> {
  const { list_ids, ...fields } = init
  const { data, error } = await getSupabase()
    .from('campaigns')
    .insert({ ...fields, workspace_id: workspaceId, created_by: userId, status: 'draft' })
    .select('id')
    .single()
  if (error) throw error
  if (list_ids?.length) {
    const { error: listErr } = await getSupabase()
      .from('campaign_lists')
      .insert(list_ids.map((list_id) => ({ campaign_id: data.id, list_id, workspace_id: workspaceId })))
    if (listErr) throw listErr
  }
  return data.id
}

/** Save content + audience. Lists are synced (added / removed) after the row update. */
export async function saveCampaign(workspaceId: string, id: string, draft: CampaignDraft, previousListIds: string[]) {
  const { list_ids, ...fields } = draft
  const db = getSupabase()
  const { data, error } = await db.from('campaigns').update(fields).eq('id', id).eq('workspace_id', workspaceId).select('id')
  if (error) throw error
  if (data.length === 0) throw new Error('You do not have permission to edit this campaign.')

  const removed = previousListIds.filter((l) => !list_ids.includes(l))
  const added = list_ids.filter((l) => !previousListIds.includes(l))
  if (removed.length) {
    const { error: delErr } = await db.from('campaign_lists').delete().eq('campaign_id', id).in('list_id', removed)
    if (delErr) throw delErr
  }
  if (added.length) {
    const { error: insErr } = await db
      .from('campaign_lists')
      .insert(added.map((list_id) => ({ campaign_id: id, list_id, workspace_id: workspaceId })))
    if (insErr) throw insErr
  }
}

export async function deleteCampaign(id: string) {
  const { error } = await getSupabase().from('campaigns').delete().eq('id', id)
  if (error) throw error
}

/** Revert a scheduled or failed campaign to draft (allowed by the DB guard). */
export async function unscheduleCampaign(id: string) {
  const { data, error } = await getSupabase().from('campaigns').update({ status: 'draft' }).eq('id', id).select('id')
  if (error) throw error
  if (data.length === 0) throw new Error('Campaign not found.')
}

export async function startCampaign(id: string): Promise<number> {
  const { data, error } = await getSupabase().rpc('start_campaign', { p_campaign_id: id })
  if (error) throw error
  return data
}

export async function scheduleCampaign(id: string, at: Date) {
  const { error } = await getSupabase().rpc('schedule_campaign', { p_campaign_id: id, p_at: at.toISOString() })
  if (error) throw error
}

export async function pauseCampaign(id: string) {
  const { error } = await getSupabase().rpc('pause_campaign', { p_campaign_id: id })
  if (error) throw error
}

export async function resumeCampaign(id: string) {
  const { error } = await getSupabase().rpc('resume_campaign', { p_campaign_id: id })
  if (error) throw error
}

export async function cancelCampaign(id: string) {
  const { error } = await getSupabase().rpc('cancel_campaign', { p_campaign_id: id })
  if (error) throw error
}

/** Test copy to the caller's own address (Edge Function `campaign-test`). */
export const sendCampaignTest = (workspaceId: string, campaignId: string) =>
  invokeFunction<{ message_id: string; to: string; mock: boolean }>('campaign-test', {
    workspace_id: workspaceId,
    campaign_id: campaignId,
  })
