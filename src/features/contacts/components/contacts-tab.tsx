import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Archive, ArchiveRestore, Download, MoreHorizontal, Pencil, Plus, Search, Tag, Trash2, Upload, Users } from 'lucide-react'
import Papa from 'papaparse'
import { useState } from 'react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/feedback/confirm-dialog'
import { NativeSelect } from '@/components/form/native-select'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { canManageWorkspace, useWorkspace } from '@/features/workspaces/workspace-context'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { downloadText } from '@/lib/download'
import { dbErrorMessage } from '@/lib/supabase/errors'
import {
  addContactsToList,
  addTagToContacts,
  contactKeys,
  DEFAULT_FILTERS,
  deleteContacts,
  fetchContactsForExport,
  PAGE_SIZE,
  setArchived,
  useContactLists,
  useContacts,
  useTags,
  type ContactFilters,
  type ContactRow,
} from '../api'
import { ContactFormDialog } from './contact-form-dialog'
import { ImportWizard } from './import-wizard'
import { CONTACT_STATUSES, statusLabel } from '../lib/status'
import { StatusBadge, TagChip } from './status-badge'

const dateFmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' })

const isFiltered = (f: ContactFilters) =>
  f.search.trim() !== '' || f.status !== 'all' || f.listId !== 'all' || f.tagId !== 'all' || f.archived

export function ContactsTab() {
  const { current } = useWorkspace()
  const queryClient = useQueryClient()
  const [filters, setFilters] = useState<ContactFilters>(DEFAULT_FILTERS)
  const [page, setPage] = useState(0)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [editing, setEditing] = useState<ContactRow | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<string[] | null>(null)
  const [exporting, setExporting] = useState(false)

  const debouncedSearch = useDebouncedValue(filters.search)
  const effectiveFilters = { ...filters, search: debouncedSearch }
  const contacts = useContacts(current.id, effectiveFilters, page)
  const lists = useContactLists(current.id)
  const tags = useTags(current.id)
  const canExport = canManageWorkspace(current.role)

  const rows = contacts.data?.rows ?? []
  const total = contacts.data?.total ?? 0
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const allOnPageSelected = rows.length > 0 && rows.every((r) => selected.has(r.id))

  function updateFilters(patch: Partial<ContactFilters>) {
    setFilters((f) => ({ ...f, ...patch }))
    setPage(0)
    setSelected(new Set())
  }

  const invalidate = () => queryClient.invalidateQueries({ queryKey: contactKeys.all(current.id) })

  const bulk = useMutation({
    mutationFn: async (action: () => Promise<void>) => action(),
    onSuccess: async () => {
      await invalidate()
      setSelected(new Set())
    },
    onError: (err) => toast.error(dbErrorMessage(err)),
  })

  const remove = useMutation({
    mutationFn: (ids: string[]) => deleteContacts(ids),
    onSuccess: async (_, ids) => {
      await invalidate()
      setSelected(new Set())
      setPendingDelete(null)
      toast.success(`${ids.length} contact${ids.length === 1 ? '' : 's'} deleted`)
    },
    onError: (err) => toast.error(dbErrorMessage(err)),
  })

  async function exportCsv() {
    setExporting(true)
    try {
      const all = await fetchContactsForExport(current.id, effectiveFilters)
      const customKeys = [...new Set(all.flatMap((c) => Object.keys(c.custom_fields as object)))]
      const csv = Papa.unparse(
        all.map((c) => ({
          email: c.email,
          first_name: c.first_name ?? '',
          last_name: c.last_name ?? '',
          status: c.status,
          consent_source: c.consent_source ?? '',
          consent_at: c.consent_at ?? '',
          lists: c.lists.map((l) => l.name).join('; '),
          tags: c.tags.map((t) => t.name).join('; '),
          created_at: c.created_at,
          ...Object.fromEntries(customKeys.map((k) => [k, String((c.custom_fields as Record<string, unknown>)[k] ?? '')])),
        })),
      )
      downloadText(`contacts-${new Date().toISOString().slice(0, 10)}.csv`, csv)
      toast.success(`Exported ${all.length} contacts`)
    } catch (err) {
      toast.error(dbErrorMessage(err))
    } finally {
      setExporting(false)
    }
  }

  const selectedIds = [...selected]

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            type="search"
            placeholder="Search email or name…"
            aria-label="Search contacts"
            className="pl-8"
            value={filters.search}
            onChange={(e) => updateFilters({ search: e.target.value })}
          />
        </div>
        <NativeSelect
          aria-label="Filter by status"
          className="w-40"
          value={filters.status}
          onChange={(e) => updateFilters({ status: e.target.value as ContactFilters['status'] })}
        >
          <option value="all">All statuses</option>
          {CONTACT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {statusLabel(s)}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect
          aria-label="Filter by list"
          className="w-40"
          value={filters.listId}
          onChange={(e) => updateFilters({ listId: e.target.value })}
        >
          <option value="all">All lists</option>
          {lists.data?.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect
          aria-label="Filter by tag"
          className="w-36"
          value={filters.tagId}
          onChange={(e) => updateFilters({ tagId: e.target.value })}
        >
          <option value="all">All tags</option>
          {tags.data?.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </NativeSelect>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={filters.archived} onCheckedChange={(c) => updateFilters({ archived: c === true })} />
          Archived
        </label>
        <div className="ml-auto flex gap-2">
          {canExport ? (
            <Button variant="outline" onClick={() => void exportCsv()} disabled={exporting || total === 0}>
              <Download aria-hidden /> {exporting ? 'Exporting…' : 'Export'}
            </Button>
          ) : null}
          <Button variant="outline" onClick={() => setImportOpen(true)}>
            <Upload aria-hidden /> Import CSV
          </Button>
          <Button
            onClick={() => {
              setEditing(null)
              setFormOpen(true)
            }}
          >
            <Plus aria-hidden /> Add contact
          </Button>
        </div>
      </div>

      {/* Bulk actions */}
      {selected.size > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/50 px-3 py-2 text-sm" role="region" aria-label="Bulk actions">
          <span className="font-medium">{selected.size} selected</span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline" disabled={bulk.isPending || !lists.data?.length}>
                <Users aria-hidden /> Add to list
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {lists.data?.map((l) => (
                <DropdownMenuItem key={l.id} onSelect={() => bulk.mutate(() => addContactsToList(current.id, l.id, selectedIds))}>
                  {l.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline" disabled={bulk.isPending || !tags.data?.length}>
                <Tag aria-hidden /> Add tag
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {tags.data?.map((t) => (
                <DropdownMenuItem key={t.id} onSelect={() => bulk.mutate(() => addTagToContacts(current.id, t.id, selectedIds))}>
                  <TagChip name={t.name} color={t.color} />
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button size="sm" variant="outline" disabled={bulk.isPending} onClick={() => bulk.mutate(() => setArchived(selectedIds, !filters.archived))}>
            {filters.archived ? <ArchiveRestore aria-hidden /> : <Archive aria-hidden />}
            {filters.archived ? 'Unarchive' : 'Archive'}
          </Button>
          <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setPendingDelete(selectedIds)}>
            <Trash2 aria-hidden /> Delete
          </Button>
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setSelected(new Set())}>
            Clear selection
          </Button>
        </div>
      ) : null}

      {/* Table */}
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <Checkbox
                  aria-label="Select all on this page"
                  checked={allOnPageSelected}
                  onCheckedChange={(c) =>
                    setSelected((prev) => {
                      const next = new Set(prev)
                      for (const r of rows) {
                        if (c === true) next.add(r.id)
                        else next.delete(r.id)
                      }
                      return next
                    })
                  }
                />
              </TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Lists</TableHead>
              <TableHead>Tags</TableHead>
              <TableHead>Added</TableHead>
              <TableHead className="w-10">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {contacts.isPending ? (
              Array.from({ length: 5 }, (_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={8}>
                    <Skeleton className="h-5" />
                  </TableCell>
                </TableRow>
              ))
            ) : contacts.error ? (
              <TableRow>
                <TableCell colSpan={8} className="py-8 text-center text-destructive">
                  {dbErrorMessage(contacts.error, 'Could not load contacts.')}
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="py-12 text-center text-muted-foreground">
                  {isFiltered(filters) ? 'No contacts match these filters.' : 'No contacts yet — add one or import a CSV.'}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((c) => (
                <TableRow key={c.id} data-state={selected.has(c.id) ? 'selected' : undefined}>
                  <TableCell>
                    <Checkbox
                      aria-label={`Select ${c.email}`}
                      checked={selected.has(c.id)}
                      onCheckedChange={(checked) =>
                        setSelected((prev) => {
                          const next = new Set(prev)
                          if (checked === true) next.add(c.id)
                          else next.delete(c.id)
                          return next
                        })
                      }
                    />
                  </TableCell>
                  <TableCell className="font-medium">{c.email}</TableCell>
                  <TableCell>{[c.first_name, c.last_name].filter(Boolean).join(' ') || '—'}</TableCell>
                  <TableCell>
                    <StatusBadge status={c.status} />
                  </TableCell>
                  <TableCell className="max-w-48 truncate text-muted-foreground">
                    {c.lists.map((l) => l.name).join(', ') || '—'}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {c.tags.map((t) => (
                        <TagChip key={t.id} name={t.name} color={t.color} />
                      ))}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{dateFmt.format(new Date(c.created_at))}</TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" aria-label={`Actions for ${c.email}`}>
                          <MoreHorizontal aria-hidden />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuLabel className="max-w-56 truncate">{c.email}</DropdownMenuLabel>
                        <DropdownMenuItem
                          onSelect={() => {
                            setEditing(c)
                            setFormOpen(true)
                          }}
                        >
                          <Pencil aria-hidden /> Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => bulk.mutate(() => setArchived([c.id], !c.archived_at))}>
                          {c.archived_at ? <ArchiveRestore aria-hidden /> : <Archive aria-hidden />}
                          {c.archived_at ? 'Unarchive' : 'Archive'}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem variant="destructive" onSelect={() => setPendingDelete([c.id])}>
                          <Trash2 aria-hidden /> Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span aria-live="polite">
          {total === 0 ? '0 contacts' : `${page * PAGE_SIZE + 1}–${Math.min(total, (page + 1) * PAGE_SIZE)} of ${total.toLocaleString()}`}
        </span>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
            Previous
          </Button>
          <span>
            Page {page + 1} / {pageCount}
          </span>
          <Button variant="outline" size="sm" disabled={page + 1 >= pageCount} onClick={() => setPage((p) => p + 1)}>
            Next
          </Button>
        </div>
      </div>

      <ContactFormDialog open={formOpen} onOpenChange={setFormOpen} contact={editing} />
      <ImportWizard open={importOpen} onOpenChange={setImportOpen} />
      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(o) => !o && setPendingDelete(null)}
        title={`Delete ${pendingDelete?.length ?? 0} contact${pendingDelete?.length === 1 ? '' : 's'}?`}
        description="This permanently removes the contacts and their list/tag memberships. Unsubscribe, bounce and complaint suppressions are kept, so deleted addresses can never be emailed by mistake."
        confirmLabel="Delete"
        destructive
        pending={remove.isPending}
        onConfirm={() => pendingDelete && remove.mutate(pendingDelete)}
      />
    </div>
  )
}
