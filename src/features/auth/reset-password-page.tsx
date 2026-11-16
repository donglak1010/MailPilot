import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { FullScreenLoader } from '@/components/feedback/full-screen-loader'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { FieldGroup } from '@/components/ui/field'
import { getSupabase } from '@/lib/supabase/client'
import { useAuth } from './auth-context'
import { authErrorMessage } from './auth-errors'
import { AuthLayout } from './auth-layout'
import { TextField } from './form-field'
import { formValue, PASSWORD_MIN, resetPasswordSchema, toFieldErrors, type FieldErrors } from './schemas'

/** Reached from the password-recovery email; Supabase signs the user in from the link. */
export default function ResetPasswordPage() {
  const { session, loading } = useAuth()
  const navigate = useNavigate()
  const [errors, setErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  if (loading) return <FullScreenLoader />

  if (!session) {
    return (
      <AuthLayout title="Link expired or invalid">
        <p className="text-sm text-muted-foreground">
          This password reset link is no longer valid.{' '}
          <Link to="/forgot-password" className="font-medium text-foreground underline-offset-4 hover:underline">
            Request a new one
          </Link>
          .
        </p>
      </AuthLayout>
    )
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const parsed = resetPasswordSchema.safeParse({
      password: formValue(form, 'password'),
      confirm: formValue(form, 'confirm'),
    })
    setFormError(null)
    if (!parsed.success) {
      setErrors(toFieldErrors(parsed.error))
      return
    }
    setErrors({})
    setPending(true)
    const { error } = await getSupabase().auth.updateUser({ password: parsed.data.password })
    setPending(false)
    if (error) {
      setFormError(authErrorMessage(error))
      return
    }
    toast.success('Password updated')
    navigate('/', { replace: true })
  }

  return (
    <AuthLayout title="Choose a new password">
      <form noValidate onSubmit={onSubmit}>
        <FieldGroup>
          {formError ? (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          ) : null}
          <TextField
            name="password"
            label="New password"
            type="password"
            autoComplete="new-password"
            hint={`At least ${PASSWORD_MIN} characters.`}
            error={errors.password}
          />
          <TextField
            name="confirm"
            label="Confirm new password"
            type="password"
            autoComplete="new-password"
            error={errors.confirm}
          />
          <Button type="submit" disabled={pending} className="w-full">
            {pending ? 'Saving…' : 'Update password'}
          </Button>
        </FieldGroup>
      </form>
    </AuthLayout>
  )
}
