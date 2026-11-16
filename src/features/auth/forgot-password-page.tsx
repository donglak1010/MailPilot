import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { FieldGroup } from '@/components/ui/field'
import { getSupabase } from '@/lib/supabase/client'
import { authErrorMessage } from './auth-errors'
import { AuthLayout } from './auth-layout'
import { TextField } from './form-field'
import { forgotPasswordSchema, formValue, toFieldErrors, type FieldErrors } from './schemas'

export default function ForgotPasswordPage() {
  const [errors, setErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [sent, setSent] = useState(false)

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const parsed = forgotPasswordSchema.safeParse({ email: formValue(new FormData(event.currentTarget), 'email') })
    setFormError(null)
    if (!parsed.success) {
      setErrors(toFieldErrors(parsed.error))
      return
    }
    setErrors({})
    setPending(true)
    const { error } = await getSupabase().auth.resetPasswordForEmail(parsed.data.email, {
      redirectTo: `${window.location.origin}/reset-password`,
    })
    setPending(false)
    // Same response whether or not the account exists (no account enumeration).
    if (error && error.code !== 'user_not_found') {
      setFormError(authErrorMessage(error))
      return
    }
    setSent(true)
  }

  return (
    <AuthLayout
      title="Reset your password"
      description="We will email you a link to choose a new password."
      footer={
        <Link to="/login" className="font-medium text-foreground underline-offset-4 hover:underline">
          Back to sign in
        </Link>
      }
    >
      {sent ? (
        <Alert>
          <AlertDescription>
            If an account exists for that address, a reset link is on its way. The link expires after a short time.
          </AlertDescription>
        </Alert>
      ) : (
        <form noValidate onSubmit={onSubmit}>
          <FieldGroup>
            {formError ? (
              <Alert variant="destructive" role="alert">
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            ) : null}
            <TextField name="email" label="Email" type="email" autoComplete="email" required error={errors.email} />
            <Button type="submit" disabled={pending} className="w-full">
              {pending ? 'Sending…' : 'Send reset link'}
            </Button>
          </FieldGroup>
        </form>
      )}
    </AuthLayout>
  )
}
