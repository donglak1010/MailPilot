import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { z } from 'zod'
import { NativeSelect } from '@/components/form/native-select'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field'
import { TextField } from '@/features/auth/form-field'
import { formValue, toFieldErrors, type FieldErrors } from '@/features/auth/schemas'
import { useWorkspace } from '@/features/workspaces/workspace-context'
import { dbErrorMessage } from '@/lib/supabase/errors'
import { contactKeys, saveContact, useContactLists, useTags, type ContactRow, type ContactStatus } from '../api'
import { StatusBadge } from './status-badge'

const EDITABLE_STATUSES: ContactStatus[] = ['pending', 'subscribed', 'unsubscribed']

const schema = z
  .object({
    email: z.email('Enter a valid email address').trim().toLowerCase(),
    first_name: z.string().trim().max(120).transform((v) => v || null),
    last_name: z.string().trim().max(120).transform((v) => v || null),
    status: z.enum(['pending', 'subscribed', 'unsubscribed', 'bounced', 'complained']),
    consent_source: z.string().trim().max(500).transform((v) => v || null),
  })
  .refine((v) => v.status !== 'subscribed' || v.consent_source, {
    path: ['consent_source'],
    message: 'Record how this person gave consent before marking them subscribed',
  })

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  contact: ContactRow | null
}

export function ContactFormDialog({ open, onOpenChange, contact }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        {open ? <ContactForm contact={contact} onDone={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  )
}

function ContactForm({ contact, onDone }: { contact: ContactRow | null; onDone: () => void }) {
  const { current } = useWorkspace()
  const queryClient = useQueryClient()
  const lists = useContactLists(current.id)
  const tags = useTags(current.id)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [status, setStatus] = useState<ContactStatus>(contact?.status ?? 'pending')
  const [listIds, setListIds] = useState<string[]>(contact?.lists.map((l) => l.id) ?? [])
  const [tagIds, setTagIds] = useState<string[]>(contact?.tags.map((t) => t.id) ?? [])
  const systemStatus = contact && (contact.status === 'bounced' || contact.status === 'complained')

  const mutation = useMutation({
    mutationFn: (input: z.infer<typeof schema>) => saveContact(current.id, input, contact, listIds, tagIds),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: contactKeys.all(current.id) })
      toast.success(contact ? 'Contact updated' : 'Contact added')
      onDone()
    },
  })

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const parsed = schema.safeParse({
      email: formValue(form, 'email'),
      first_name: formValue(form, 'first_name'),
      last_name: formValue(form, 'last_name'),
      status,
      consent_source: formValue(form, 'consent_source'),
    })
    if (!parsed.success) {
      setErrors(toFieldErrors(parsed.error))
      return
    }
    setErrors({})
    mutation.mutate(parsed.data)
  }

  const toggle = (setter: (fn: (prev: string[]) => string[]) => void, id: string, checked: boolean) =>
    setter((prev) => (checked ? [...prev, id] : prev.filter((x) => x !== id)))

  return (
    <form noValidate onSubmit={onSubmit}>
      <DialogHeader>
        <DialogTitle>{contact ? 'Edit contact' : 'Add contact'}</DialogTitle>
        <DialogDescription>Only add people who agreed to receive email from you.</DialogDescription>
      </DialogHeader>

      <FieldGroup className="py-4">
        {mutation.error ? (
          <Alert variant="destructive" role="alert">
            <AlertDescription>{dbErrorMessage(mutation.error)}</AlertDescription>
          </Alert>
        ) : null}
        <TextField name="email" label="Email" type="email" defaultValue={contact?.email} error={errors.email} />
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField name="first_name" label="First name" defaultValue={contact?.first_name ?? ''} error={errors.first_name} />
          <TextField name="last_name" label="Last name" defaultValue={contact?.last_name ?? ''} error={errors.last_name} />
        </div>

        <Field>
          <FieldLabel htmlFor="field-status">Status</FieldLabel>
          {systemStatus ? (
            <div className="flex items-center gap-2 text-sm">
              <StatusBadge status={contact.status} />
              <span className="text-muted-foreground">Set by delivery events; cannot be changed manually.</span>
            </div>
          ) : (
            <NativeSelect id="field-status" value={status} onChange={(e) => setStatus(e.target.value as ContactStatus)}>
              {EDITABLE_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s[0]!.toUpperCase() + s.slice(1)}
                </option>
              ))}
            </NativeSelect>
          )}
          <FieldDescription>Only subscribed contacts receive campaigns and sequences.</FieldDescription>
        </Field>

        {status === 'subscribed' && !systemStatus ? (
          <TextField
            name="consent_source"
            label="Consent source"
            placeholder="e.g. Signed up via ebook landing page, 2026-11-01"
            defaultValue={contact?.consent_source ?? ''}
            hint="Where and how this person agreed to receive marketing email."
            error={errors.consent_source}
          />
        ) : (
          <input type="hidden" name="consent_source" value={contact?.consent_source ?? ''} />
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <CheckboxGroup
            legend="Lists"
            empty="No lists yet"
            items={(lists.data ?? []).map((l) => ({ id: l.id, label: l.name }))}
            selected={listIds}
            onToggle={(id, c) => toggle(setListIds, id, c)}
          />
          <CheckboxGroup
            legend="Tags"
            empty="No tags yet"
            items={(tags.data ?? []).map((t) => ({ id: t.id, label: t.name }))}
            selected={tagIds}
            onToggle={(id, c) => toggle(setTagIds, id, c)}
          />
        </div>

        {contact && Object.keys(contact.custom_fields as object).length > 0 ? (
          <Field>
            <FieldLabel>Custom fields</FieldLabel>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-md border p-3 text-sm">
              {Object.entries(contact.custom_fields as Record<string, unknown>).map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="font-mono text-xs text-muted-foreground">{k}</dt>
                  <dd className="truncate">{String(v)}</dd>
                </div>
              ))}
            </dl>
          </Field>
        ) : null}
        {errors.form ? <FieldError>{errors.form}</FieldError> : null}
      </FieldGroup>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone} disabled={mutation.isPending}>
          Cancel
        </Button>
        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? 'Saving…' : contact ? 'Save changes' : 'Add contact'}
        </Button>
      </DialogFooter>
    </form>
  )
}

function CheckboxGroup({
  legend,
  empty,
  items,
  selected,
  onToggle,
}: {
  legend: string
  empty: string
  items: { id: string; label: string }[]
  selected: string[]
  onToggle: (id: string, checked: boolean) => void
}) {
  return (
    <FieldSet>
      <FieldLegend variant="label">{legend}</FieldLegend>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <div className="max-h-36 space-y-2 overflow-y-auto rounded-md border p-2">
          {items.map((item) => (
            <label key={item.id} className="flex items-center gap-2 text-sm">
              <Checkbox checked={selected.includes(item.id)} onCheckedChange={(c) => onToggle(item.id, c === true)} />
              <span className="truncate">{item.label}</span>
            </label>
          ))}
        </div>
      )}
    </FieldSet>
  )
}
