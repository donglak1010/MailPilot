import { useQuery } from '@tanstack/react-query'
import { getSupabase } from '@/lib/supabase/client'
import type { WorkspaceWithRole } from '@/types/app'

export const workspaceKeys = {
  all: ['workspaces'] as const,
  list: (userId: string) => ['workspaces', 'list', userId] as const,
  members: (workspaceId: string) => ['workspaces', 'members', workspaceId] as const,
  usage: (workspaceId: string) => ['workspaces', 'usage', workspaceId] as const,
}

export async function fetchMyWorkspaces(userId: string): Promise<WorkspaceWithRole[]> {
  const { data, error } = await getSupabase()
    .from('workspace_members')
    .select('role, created_at, workspace:workspaces(*)')
    .eq('user_id', userId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return data.flatMap((m) => (m.workspace ? [{ ...m.workspace, role: m.role }] : []))
}

export function useMyWorkspaces(userId: string) {
  return useQuery({
    queryKey: workspaceKeys.list(userId),
    queryFn: () => fetchMyWorkspaces(userId),
  })
}

export type MemberRow = { userId: string; role: WorkspaceRole; fullName: string | null; joinedAt: string }
type WorkspaceRole = WorkspaceWithRole['role']

export function useWorkspaceMembers(workspaceId: string) {
  return useQuery({
    queryKey: workspaceKeys.members(workspaceId),
    queryFn: async (): Promise<MemberRow[]> => {
      const supabase = getSupabase()
      const { data: members, error } = await supabase
        .from('workspace_members')
        .select('user_id, role, created_at')
        .eq('workspace_id', workspaceId)
        .order('created_at')
      if (error) throw error
      const ids = members.map((m) => m.user_id)
      const { data: profiles, error: pErr } = await supabase.from('profiles').select('id, full_name').in('id', ids)
      if (pErr) throw pErr
      const names = new Map(profiles.map((p) => [p.id, p.full_name]))
      return members.map((m) => ({
        userId: m.user_id,
        role: m.role,
        fullName: names.get(m.user_id) ?? null,
        joinedAt: m.created_at,
      }))
    },
  })
}

export type UsageSummary = { sentToday: number; sentThisMonth: number; aiThisMonth: number }

export function useWorkspaceUsage(workspaceId: string) {
  return useQuery({
    queryKey: workspaceKeys.usage(workspaceId),
    queryFn: async (): Promise<UsageSummary> => {
      const now = new Date()
      const today = now.toISOString().slice(0, 10)
      const monthStart = `${today.slice(0, 7)}-01`
      const { data, error } = await getSupabase()
        .from('usage_records')
        .select('metric, usage_date, quantity')
        .eq('workspace_id', workspaceId)
        .gte('usage_date', monthStart)
      if (error) throw error
      const rows = data
      const sum = (pred: (r: (typeof rows)[number]) => boolean) =>
        rows.filter(pred).reduce((acc, r) => acc + r.quantity, 0)
      return {
        sentToday: sum((r) => r.metric === 'emails_sent' && r.usage_date === today),
        sentThisMonth: sum((r) => r.metric === 'emails_sent'),
        aiThisMonth: sum((r) => r.metric === 'ai_generations'),
      }
    },
  })
}
