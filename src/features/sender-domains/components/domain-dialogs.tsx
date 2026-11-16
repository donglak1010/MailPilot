import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { useUser } from '@/features/auth/auth-context'
import { TextField } from '@/features/auth/form-field'
import { formValue } from '@/features/auth/schemas'
import { workspaceKeys } from '@/features/workspaces/api'
import { useWorkspace } from '@/features/workspaces/workspace-context'
import { getSupabase } from '@/lib/supabase/client'
import { createDomain, senderDomainKeys, sendTestEmail, type SenderDomain } from '../api'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function AddDomainDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { current } = useWorkspace()
  const queryClient = useQueryClient()
  const [error, setError] = useState<string>()

  const mutation = useMutation({
    mutationFn: (domain: string) => createDomain(current.id, domain),
    onSuccess: async (d) => {
      await queryClient.invalidateQueries({ queryKey: senderDomainKeys.list(current.id) })
      toast.success(`${d.domain} added — now publish the DNS records`)
      onOpenChange(false)
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'Could not add the domain'),
  })

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const domain = formValue(new FormData(event.currentTarget), 'domain')
    if (!domain) return setError('Enter a domain.')
    setError(undefined)
    mutation.mutate(domain)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setError(undefined)
        onOpenChange(o)
      }}
    >
      <DialogContent>
        <form noValidate onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>Add sending domain</DialogTitle>
            <DialogDescription>
              Use a subdomain dedicated to email, e.g. <code>mail.yourbrand.com</code>. Your website and existing mailbox
              records stay untouched.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup className="py-4">
            <TextField
              name="domain"
              label="Domain"
              placeholder="mail.yourbrand.com"
              autoComplete="off"
              autoFocus
              error={error}
              disabled={mutation.isPending}
              hint="You must be able to add DNS records for this domain."
            />
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? 'Adding…' : 'Add domain'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function SendTestDialog({
  domain,
  onOpenChange,
}: {
  domain: SenderDomain | null
  onOpenChange: (o: boolean) => void
}) {
  const { current } = useWorkspace()
  const user = useUser()
  const queryClient = useQueryClient()
  const [errors, setErrors] = useState<Record<string, string>>({})

  const defaultLocal =
    current.default_from_email && domain && current.default_from_email.toLowerCase().endsWith(`@${domain.domain}`)
      ? current.default_from_email.split('@')[0]
      : 'hello'

  const mutation = useMutation({
    mutationFn: async (input: { from_email: string; from_name: string; reply_to: string; saveDefault: boolean }) => {
      const result = await sendTestEmail(current.id, {
        domain_id: domain!.id,
        from_email: input.from_email,
        from_name: input.from_name || undefined,
        reply_to: input.reply_to || undefined,
      })
      if (input.saveDefault) {
        const { data, error } = await getSupabase()
          .from('workspaces')
          .update({
            default_from_email: input.from_email,
            default_from_name: input.from_name || null,
            default_reply_to: input.reply_to || null,
          })
          .eq('id', current.id)
          .select('id')
        if (error || data.length === 0) toast.error('Test sent, but the default sender could not be saved.')
        else await queryClient.invalidateQueries({ queryKey: workspaceKeys.all })
      }
      return result
    },
    onSuccess: (r) => {
      toast.success(r.mock ? `Mock send OK (no email delivered) — ${r.message_id}` : `Test email sent to ${r.to}`)
      onOpenChange(false)
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Could not send the test email'),
  })

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!domain) return
    const form = new FormData(event.currentTarget)
    const local = formValue(form, 'from_local').toLowerCase()
    const fromEmail = `${local}@${domain.domain}`
    const replyTo = formValue(form, 'reply_to')
    const next: Record<string, string> = {}
    if (!local || !/^[a-z0-9._+-]+$/.test(local)) next.from_local = 'Use letters, digits, dot, dash or underscore.'
    if (replyTo && !EMAIL_RE.test(replyTo)) next.reply_to = 'Not a valid email address.'
    setErrors(next)
    if (Object.keys(next).length > 0) return
    mutation.mutate({
      from_email: fromEmail,
      from_name: formValue(form, 'from_name'),
      reply_to: replyTo,
      saveDefault: form.get('save_default') === 'on',
    })
  }

  return (
    <Dialog open={domain !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        {domain ? (
          <form noValidate onSubmit={onSubmit}>
            <DialogHeader>
              <DialogTitle>Send a test email</DialogTitle>
              <DialogDescription>
                Sent only to your own address <strong>{user.email}</strong>. While SES is in sandbox mode this address must
                also be verified in Amazon SES.
              </DialogDescription>
            </DialogHeader>
            <fieldset disabled={mutation.isPending} className="contents">
              <FieldGroup className="py-4">
                <Field data-invalid={errors.from_local ? true : undefined}>
                  <FieldLabel htmlFor="field-from_local">From address</FieldLabel>
                  <div className="flex items-center gap-2">
                    <Input
                      id="field-from_local"
                      name="from_local"
                      defaultValue={defaultLocal}
                      className="max-w-48"
                      aria-invalid={errors.from_local ? true : undefined}
                    />
                    <span className="text-muted-foreground truncate text-sm">@{domain.domain}</span>
                  </div>
                  {errors.from_local ? <FieldDescription className="text-destructive">{errors.from_local}</FieldDescription> : null}
                </Field>
                <TextField name="from_name" label="From name" defaultValue={current.default_from_name ?? current.name} />
                <TextField
                  name="reply_to"
                  label="Reply-To (optional)"
                  type="email"
                  defaultValue={current.default_reply_to ?? ''}
                  error={errors.reply_to}
                  hint="A real inbox you read. The sending subdomain itself cannot receive replies."
                />
                <Field orientation="horizontal">
                  <Checkbox id="field-save_default" name="save_default" />
                  <FieldLabel htmlFor="field-save_default" className="font-normal">
                    Save as the workspace default sender
                  </FieldLabel>
                </Field>
              </FieldGroup>
            </fieldset>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>
                Cancel
              </Button>
              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending ? 'Sending…' : 'Send test'}
              </Button>
            </DialogFooter>
          </form>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
