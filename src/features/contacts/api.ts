import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { getSupabase } from '@/lib/supabase/client'
import type { Enums, Tables } from '@/types/app'

export type ContactStatus = Enums<'contact_status'>
export type Contact = Tables<'contacts'>
export type ContactList = Tables<'contact_lists'> & { member_count: number }
export type Tag = Tables<'tags'> & { contact_count: number }
export type CsvImport = Tables<'csv_imports'>

export type ContactRow = Contact & {
  lists: { id: string; name: string }[]
  tags: { id: string; name: string; color: string | null }[]
}

export type ContactFilters = {
  search: string
  status: ContactStatus | 'all'
  listId: string | 'all'
  tagId: string | 'all'
  archived: boolean
}

export const DEFAULT_FILTERS: ContactFilters = { search: '', status: 'all', listId: 'all', tagId: 'all', archived: false }
export const PAGE_SIZE = 25

export const contactKeys = {
  all: (ws: string) => ['contacts', ws] as const,
  list: (ws: string, filters: ContactFilters, page: number) => ['contacts', ws, 'list', filters, page] as const,
  lists: (ws: string) => ['contacts', ws, 'lists'] as const,
  tags: (ws: string) => ['contacts', ws, 'tags'] as const,
  imports: (ws: string) => ['contacts', ws, 'imports'] as const,
}

/** Strip characters that have meaning in PostgREST filter syntax. */
export function sanitizeSearch(raw: string): string {
  return raw.replace(/[,()*%\\"':]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100)
}

const SELECT_CONTACT = `*,
  list_links:contact_list_members(list:contact_lists(id, name)),
  tag_links:contact_tags(tag:tags(id, name, color))`

type RawContact = Contact & {
  list_links: { list: { id: string; name: string } | null }[]
  tag_links: { tag: { id: string; name: string; color: string | null } | null }[]
}

function toContactRow(raw: RawContact): ContactRow {
  const { list_links, tag_links, ...contact } = raw
  return {
    ...contact,
    lists: list_links.flatMap((l) => (l.list ? [l.list] : [])),
    tags: tag_links.flatMap((t) => (t.tag ? [t.tag] : [])),
  }
}

function buildContactQuery(workspaceId: string, filters: ContactFilters, select: string) {
  const supabase = getSupabase()
  // Inner-join filters use separate aliases so the displayed lists/tags stay complete.
  let extra = ''
  if (filters.listId !== 'all') extra += ', list_filter:contact_list_members!inner(list_id)'
  if (filters.tagId !== 'all') extra += ', tag_filter:contact_tags!inner(tag_id)'

  let query = supabase
    .from('contacts')
    .select(select + extra, { count: 'exact' })
    .eq('workspace_id', workspaceId)

  query = filters.archived ? query.not('archived_at', 'is', null) : query.is('archived_at', null)
  if (filters.status !== 'all') query = query.eq('status', filters.status)
  if (filters.listId !== 'all') query = query.eq('list_filter.list_id', filters.listId)
  if (filters.tagId !== 'all') query = query.eq('tag_filter.tag_id', filters.tagId)

  const term = sanitizeSearch(filters.search)
  if (term) query = query.or(`email.ilike.*${term}*,first_name.ilike.*${term}*,last_name.ilike.*${term}*`)
  return query
}

export function useContacts(workspaceId: string, filters: ContactFilters, page: number) {
  return useQuery({
    queryKey: contactKeys.list(workspaceId, filters, page),
    placeholderData: keepPreviousData,
    queryFn: async () => {
      const from = page * PAGE_SIZE
      const { data, error, count } = await buildContactQuery(workspaceId, filters, SELECT_CONTACT)
        .order('created_at', { ascending: false })
        .order('id')
        .range(from, from + PAGE_SIZE - 1)
      if (error) throw error
      return { rows: (data as unknown as RawContact[]).map(toContactRow), total: count ?? 0 }
    },
  })
}

/** All contacts matching the filters, for CSV export (capped). */
export async function fetchContactsForExport(workspaceId: string, filters: ContactFilters, cap = 20_000) {
  const out: ContactRow[] = []
  const step = 1000
  for (let from = 0; from < cap; from += step) {
    const { data, error } = await buildContactQuery(workspaceId, filters, SELECT_CONTACT)
      .order('created_at', { ascending: true })
      .order('id')
      .range(from, from + step - 1)
    if (error) throw error
    const rows = (data as unknown as RawContact[]).map(toContactRow)
    out.push(...rows)
    if (rows.length < step) break
  }
  return out
}

export function useContactLists(workspaceId: string) {
  return useQuery({
    queryKey: contactKeys.lists(workspaceId),
    queryFn: async (): Promise<ContactList[]> => {
      const { data, error } = await getSupabase()
        .from('contact_lists')
        .select('*, contact_list_members(count)')
        .eq('workspace_id', workspaceId)
        .order('name')
      if (error) throw error
      return data.map(({ contact_list_members, ...l }) => ({
        ...l,
        member_count: (contact_list_members as unknown as { count: number }[])[0]?.count ?? 0,
      }))
    },
  })
}

export function useTags(workspaceId: string) {
  return useQuery({
    queryKey: contactKeys.tags(workspaceId),
    queryFn: async (): Promise<Tag[]> => {
      const { data, error } = await getSupabase()
        .from('tags')
        .select('*, contact_tags(count)')
        .eq('workspace_id', workspaceId)
        .order('name')
      if (error) throw error
      return data.map(({ contact_tags, ...t }) => ({
        ...t,
        contact_count: (contact_tags as unknown as { count: number }[])[0]?.count ?? 0,
      }))
    },
  })
}

export function useImports(workspaceId: string) {
  return useQuery({
    queryKey: contactKeys.imports(workspaceId),
    queryFn: async (): Promise<CsvImport[]> => {
      const { data, error } = await getSupabase()
        .from('csv_imports')
        .select('*')
        .eq('workspace_id', workspaceId)
        .order('created_at', { ascending: false })
        .limit(50)
      if (error) throw error
      return data
    },
  })
}

// ---------------------------------------------------------------------
// Mutations (plain async functions; components wrap them in useMutation)
// ---------------------------------------------------------------------

export type ContactInput = {
  email: string
  first_name: string | null
  last_name: string | null
  status: ContactStatus
  consent_source: string | null
}

export async function saveContact(
  workspaceId: string,
  input: ContactInput,
  existing: Contact | null,
  listIds: string[],
  tagIds: string[],
): Promise<string> {
  const supabase = getSupabase()
  const becomesSubscribed = input.status === 'subscribed' && existing?.status !== 'subscribed'
  const consent_at = input.status === 'subscribed' ? (becomesSubscribed ? new Date().toISOString() : existing?.consent_at) : existing?.consent_at

  let id: string
  if (existing) {
    const { error } = await supabase
      .from('contacts')
      .update({ ...input, consent_at: consent_at ?? null })
      .eq('id', existing.id)
    if (error) throw error
    id = existing.id
  } else {
    const { data, error } = await supabase
      .from('contacts')
      .insert({ ...input, workspace_id: workspaceId, source: 'manual', consent_at: consent_at ?? null })
      .select('id')
      .single()
    if (error) throw error
    id = data.id
  }

  await syncLinks('contact_list_members', 'list_id', workspaceId, id, listIds)
  await syncLinks('contact_tags', 'tag_id', workspaceId, id, tagIds)
  return id
}

async function syncLinks(
  table: 'contact_list_members' | 'contact_tags',
  column: 'list_id' | 'tag_id',
  workspaceId: string,
  contactId: string,
  wanted: string[],
) {
  const supabase = getSupabase()
  const { data, error } = await supabase.from(table).select(column).eq('contact_id', contactId)
  if (error) throw error
  const current = new Set((data as unknown as Record<string, string>[]).map((r) => r[column]!))
  const target = new Set(wanted)
  const toAdd = wanted.filter((v) => !current.has(v))
  const toRemove = [...current].filter((v) => !target.has(v))
  if (toAdd.length) {
    const rows = toAdd.map((v) => ({ [column]: v, contact_id: contactId, workspace_id: workspaceId }))
    const { error: e } = await supabase.from(table).insert(rows as never)
    if (e) throw e
  }
  if (toRemove.length) {
    const { error: e } = await supabase.from(table).delete().eq('contact_id', contactId).in(column, toRemove)
    if (e) throw e
  }
}

export async function setArchived(contactIds: string[], archived: boolean) {
  const { error } = await getSupabase()
    .from('contacts')
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .in('id', contactIds)
  if (error) throw error
}

export async function deleteContacts(contactIds: string[]) {
  const { error } = await getSupabase().from('contacts').delete().in('id', contactIds)
  if (error) throw error
}

export async function addContactsToList(workspaceId: string, listId: string, contactIds: string[]) {
  const rows = contactIds.map((contact_id) => ({ list_id: listId, contact_id, workspace_id: workspaceId }))
  const { error } = await getSupabase()
    .from('contact_list_members')
    .upsert(rows, { onConflict: 'list_id,contact_id', ignoreDuplicates: true })
  if (error) throw error
}

export async function addTagToContacts(workspaceId: string, tagId: string, contactIds: string[]) {
  const rows = contactIds.map((contact_id) => ({ tag_id: tagId, contact_id, workspace_id: workspaceId }))
  const { error } = await getSupabase()
    .from('contact_tags')
    .upsert(rows, { onConflict: 'tag_id,contact_id', ignoreDuplicates: true })
  if (error) throw error
}

export async function saveList(workspaceId: string, input: { name: string; description: string | null }, id?: string) {
  const supabase = getSupabase()
  const { error } = id
    ? await supabase.from('contact_lists').update(input).eq('id', id)
    : await supabase.from('contact_lists').insert({ ...input, workspace_id: workspaceId })
  if (error) throw error
}

export async function deleteList(id: string) {
  const { error } = await getSupabase().from('contact_lists').delete().eq('id', id)
  if (error) throw error
}

export async function saveTag(workspaceId: string, input: { name: string; color: string | null }, id?: string) {
  const supabase = getSupabase()
  const { error } = id
    ? await supabase.from('tags').update(input).eq('id', id)
    : await supabase.from('tags').insert({ ...input, workspace_id: workspaceId })
  if (error) throw error
}

export async function deleteTag(id: string) {
  const { error } = await getSupabase().from('tags').delete().eq('id', id)
  if (error) throw error
}
