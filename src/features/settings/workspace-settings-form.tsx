import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Textarea } from '@/components/ui/textarea'
import { TextField } from '@/features/auth/form-field'
import { formValue, toFieldErrors, type FieldErrors } from '@/features/auth/schemas'
import { workspaceKeys } from '@/features/workspaces/api'
import { canManageWorkspace, useWorkspace } from '@/features/workspaces/workspace-context'
import { getSupabase } from '@/lib/supabase/client'
import { listTimezones, workspaceSettingsSchema, type WorkspaceSettingsInput } from './workspace-schema'

export function WorkspaceSettingsForm() {
  const { current } = useWorkspace()
  const queryClient = useQueryClient()
  const editable = canManageWorkspace(current.role)
  const timezones = useMemo(() => listTimezones(current.timezone), [current.timezone])
  const [errors, setErrors] = useState<FieldErrors>({})

  const mutation = useMutation({
    mutationFn: async (input: WorkspaceSettingsInput) => {
      const { data, error } = await getSupabase()
        .from('workspaces')
        .update(input)
        .eq('id', current.id)
        .select('id')
      if (error) throw error
      // RLS filters rows silently: zero rows means "not allowed".
      if (data.length === 0) throw new Error('You do not have permission to edit this workspace.')
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: workspaceKeys.all })
      toast.success('Workspace settings saved')
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Could not save settings'),
  })

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const parsed = workspaceSettingsSchema.safeParse({
      name: formValue(form, 'name'),
      timezone: formValue(form, 'timezone'),
      default_from_name: formValue(form, 'default_from_name'),
      default_from_email: formValue(form, 'default_from_email'),
      default_reply_to: formValue(form, 'default_reply_to'),
      postal_address: formValue(form, 'postal_address'),
    })
    if (!parsed.success) {
      setErrors(toFieldErrors(parsed.error))
      return
    }
    setErrors({})
    mutation.mutate(parsed.data)
  }

  return (
    <Card>
      <form noValidate onSubmit={onSubmit} key={current.id}>
        <CardHeader>
          <CardTitle>Workspace</CardTitle>
          <CardDescription>Name, timezone and the default sender used for new campaigns.</CardDescription>
        </CardHeader>
        <CardContent>
          {!editable ? (
            <Alert className="mb-4">
              <AlertDescription>Only workspace owners and admins can change these settings.</AlertDescription>
            </Alert>
          ) : null}
          <fieldset disabled={!editable || mutation.isPending} className="contents">
            <FieldGroup>
              <TextField name="name" label="Workspace name" defaultValue={current.name} error={errors.name} />
              <Field data-invalid={errors.timezone ? true : undefined}>
                <FieldLabel htmlFor="field-timezone">Timezone</FieldLabel>
                <select
                  id="field-timezone"
                  name="timezone"
                  defaultValue={current.timezone}
                  className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50"
                >
                  {timezones.map((tz) => (
                    <option key={tz} value={tz}>
                      {tz}
                    </option>
                  ))}
                </select>
                <FieldDescription>Scheduled campaigns use this timezone.</FieldDescription>
                {errors.timezone ? <FieldError>{errors.timezone}</FieldError> : null}
              </Field>
              <div className="grid gap-4 md:grid-cols-2">
                <TextField
                  name="default_from_name"
                  label="Default From name"
                  defaultValue={current.default_from_name ?? ''}
                  error={errors.default_from_name}
                />
                <TextField
                  name="default_from_email"
                  label="Default From email"
                  type="email"
                  defaultValue={current.default_from_email ?? ''}
                  hint="Must belong to a verified sender domain (Phase 3)."
                  error={errors.default_from_email}
                />
              </div>
              <TextField
                name="default_reply_to"
                label="Default Reply-To"
                type="email"
                defaultValue={current.default_reply_to ?? ''}
                error={errors.default_reply_to}
              />
              <Field data-invalid={errors.postal_address ? true : undefined}>
                <FieldLabel htmlFor="field-postal_address">Postal address</FieldLabel>
                <Textarea
                  id="field-postal_address"
                  name="postal_address"
                  rows={3}
                  defaultValue={current.postal_address ?? ''}
                  aria-invalid={errors.postal_address ? true : undefined}
                />
                <FieldDescription>
                  Shown in every email footer ({'{{postal_address}}'}). Anti-spam laws such as CAN-SPAM require a valid
                  physical address.
                </FieldDescription>
                {errors.postal_address ? <FieldError>{errors.postal_address}</FieldError> : null}
              </Field>
            </FieldGroup>
          </fieldset>
        </CardContent>
        {editable ? (
          <CardFooter className="justify-end">
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? 'Saving…' : 'Save changes'}
            </Button>
          </CardFooter>
        ) : null}
      </form>
    </Card>
  )
}
