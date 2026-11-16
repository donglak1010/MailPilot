import { useMutation, useQueryClient } from '@tanstack/react-query'
import { MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/feedback/confirm-dialog'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { TextField } from '@/features/auth/form-field'
import { formValue } from '@/features/auth/schemas'
import { useWorkspace } from '@/features/workspaces/workspace-context'
import { dbErrorMessage } from '@/lib/supabase/errors'
import { contactKeys, deleteList, deleteTag, saveList, saveTag, useContactLists, useTags } from '../api'
import { TagChip } from './status-badge'

const TAG_COLORS = ['#64748b', '#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899']

type Editable = { id: string; name: string; description?: string | null; color?: string | null }

function NameDialog({
  open,
  onOpenChange,
  title,
  item,
  withDescription,
  withColor,
  onSave,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  title: string
  item: Editable | null
  withDescription?: boolean
  withColor?: boolean
  onSave: (input: { name: string; description: string | null; color: string | null }) => Promise<void>
}) {
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [color, setColor] = useState<string>(item?.color ?? TAG_COLORS[0]!)

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const name = formValue(form, 'name').trim()
    const description = formValue(form, 'description').trim() || null
    if (!name) return setError('Enter a name')
    if (name.length > (withColor ? 60 : 120)) return setError('Name is too long')
    setPending(true)
    try {
      await onSave({ name, description, color: withColor ? color : null })
      onOpenChange(false)
    } catch (err) {
      setError(
        (err as { code?: string }).code === '23505' ? 'That name is already used in this workspace.' : dbErrorMessage(err),
      )
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form noValidate onSubmit={onSubmit} key={item?.id ?? 'new'}>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
          <FieldGroup className="py-4">
            <TextField name="name" label="Name" defaultValue={item?.name ?? ''} error={error ?? undefined} autoFocus />
            {withDescription ? (
              <TextField name="description" label="Description (optional)" defaultValue={item?.description ?? ''} />
            ) : null}
            {withColor ? (
              <Field>
                <FieldLabel>Color</FieldLabel>
                <div className="flex gap-2" role="radiogroup" aria-label="Tag color">
                  {TAG_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      role="radio"
                      aria-checked={color === c}
                      aria-label={c}
                      onClick={() => setColor(c)}
                      className="size-7 rounded-full border-2 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-checked:border-foreground"
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </Field>
            ) : null}
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function useCrudState() {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Editable | null>(null)
  const [deleting, setDeleting] = useState<Editable | null>(null)
  return {
    dialogOpen,
    setDialogOpen,
    editing,
    deleting,
    setDeleting,
    openNew: () => {
      setEditing(null)
      setDialogOpen(true)
    },
    openEdit: (item: Editable) => {
      setEditing(item)
      setDialogOpen(true)
    },
  }
}

function RowMenu({ label, onEdit, onDelete }: { label: string; onEdit: () => void; onDelete: () => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={`Actions for ${label}`}>
          <MoreHorizontal aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={onEdit}>
          <Pencil aria-hidden /> Rename
        </DropdownMenuItem>
        <DropdownMenuItem variant="destructive" onSelect={onDelete}>
          <Trash2 aria-hidden /> Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function ListsTab() {
  const { current } = useWorkspace()
  const queryClient = useQueryClient()
  const lists = useContactLists(current.id)
  const s = useCrudState()
  const invalidate = () => queryClient.invalidateQueries({ queryKey: contactKeys.all(current.id) })

  const remove = useMutation({
    mutationFn: (id: string) => deleteList(id),
    onSuccess: async () => {
      await invalidate()
      s.setDeleting(null)
      toast.success('List deleted')
    },
    onError: (err) =>
      toast.error(
        (err as { code?: string }).code === '23503'
          ? 'This list is used by a sequence or campaign. Remove it there first.'
          : dbErrorMessage(err),
      ),
  })

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Lists are audiences you send campaigns to and that can trigger sequences.</p>
        <Button onClick={s.openNew}>
          <Plus aria-hidden /> New list
        </Button>
      </div>
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Description</TableHead>
              <TableHead className="text-right">Contacts</TableHead>
              <TableHead className="w-10">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lists.isPending ? (
              <TableRow>
                <TableCell colSpan={4}>
                  <Skeleton className="h-5" />
                </TableCell>
              </TableRow>
            ) : lists.data?.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="py-10 text-center text-muted-foreground">
                  No lists yet. Create one such as "Ebook buyers" or "Newsletter".
                </TableCell>
              </TableRow>
            ) : (
              lists.data?.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="font-medium">{l.name}</TableCell>
                  <TableCell className="text-muted-foreground">{l.description || '—'}</TableCell>
                  <TableCell className="text-right tabular-nums">{l.member_count.toLocaleString()}</TableCell>
                  <TableCell>
                    <RowMenu label={l.name} onEdit={() => s.openEdit(l)} onDelete={() => s.setDeleting(l)} />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      <NameDialog
        open={s.dialogOpen}
        onOpenChange={s.setDialogOpen}
        title={s.editing ? 'Rename list' : 'New list'}
        item={s.editing}
        withDescription
        onSave={async ({ name, description }) => {
          await saveList(current.id, { name, description }, s.editing?.id)
          await invalidate()
          toast.success(s.editing ? 'List updated' : 'List created')
        }}
      />
      <ConfirmDialog
        open={s.deleting !== null}
        onOpenChange={(o) => !o && s.setDeleting(null)}
        title={`Delete list "${s.deleting?.name ?? ''}"?`}
        description="Contacts stay in your workspace; only the list and its memberships are removed."
        confirmLabel="Delete list"
        destructive
        pending={remove.isPending}
        onConfirm={() => s.deleting && remove.mutate(s.deleting.id)}
      />
    </div>
  )
}

export function TagsTab() {
  const { current } = useWorkspace()
  const queryClient = useQueryClient()
  const tags = useTags(current.id)
  const s = useCrudState()
  const invalidate = () => queryClient.invalidateQueries({ queryKey: contactKeys.all(current.id) })

  const remove = useMutation({
    mutationFn: (id: string) => deleteTag(id),
    onSuccess: async () => {
      await invalidate()
      s.setDeleting(null)
      toast.success('Tag deleted')
    },
    onError: (err) => toast.error(dbErrorMessage(err)),
  })

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Tags label contacts by interest or purchase, e.g. "bought-ebook".</p>
        <Button onClick={s.openNew}>
          <Plus aria-hidden /> New tag
        </Button>
      </div>
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Tag</TableHead>
              <TableHead className="text-right">Contacts</TableHead>
              <TableHead className="w-10">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tags.isPending ? (
              <TableRow>
                <TableCell colSpan={3}>
                  <Skeleton className="h-5" />
                </TableCell>
              </TableRow>
            ) : tags.data?.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} className="py-10 text-center text-muted-foreground">
                  No tags yet.
                </TableCell>
              </TableRow>
            ) : (
              tags.data?.map((t) => (
                <TableRow key={t.id}>
                  <TableCell>
                    <TagChip name={t.name} color={t.color} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{t.contact_count.toLocaleString()}</TableCell>
                  <TableCell>
                    <RowMenu label={t.name} onEdit={() => s.openEdit(t)} onDelete={() => s.setDeleting(t)} />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      <NameDialog
        open={s.dialogOpen}
        onOpenChange={s.setDialogOpen}
        title={s.editing ? 'Edit tag' : 'New tag'}
        item={s.editing}
        withColor
        onSave={async ({ name, color }) => {
          await saveTag(current.id, { name, color }, s.editing?.id)
          await invalidate()
          toast.success(s.editing ? 'Tag updated' : 'Tag created')
        }}
      />
      <ConfirmDialog
        open={s.deleting !== null}
        onOpenChange={(o) => !o && s.setDeleting(null)}
        title={`Delete tag "${s.deleting?.name ?? ''}"?`}
        description="The tag is removed from all contacts. Contacts themselves are not deleted."
        confirmLabel="Delete tag"
        destructive
        pending={remove.isPending}
        onConfirm={() => s.deleting && remove.mutate(s.deleting.id)}
      />
    </div>
  )
}
