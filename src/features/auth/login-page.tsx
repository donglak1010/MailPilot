import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { FieldGroup } from '@/components/ui/field'
import { getSupabase } from '@/lib/supabase/client'
import { authErrorMessage } from './auth-errors'
import { AuthLayout } from './auth-layout'
import { TextField } from './form-field'
import { safeNextPath } from './safe-redirect'
import { formValue, loginSchema, toFieldErrors, type FieldErrors } from './schemas'

export default function LoginPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [errors, setErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const parsed = loginSchema.safeParse({ email: formValue(form, 'email'), password: formValue(form, 'password') })
    setFormError(null)
    if (!parsed.success) {
      setErrors(toFieldErrors(parsed.error))
      return
    }
    setErrors({})
    setPending(true)
    const { error } = await getSupabase().auth.signInWithPassword(parsed.data)
    setPending(false)
    if (error) {
      setFormError(authErrorMessage(error))
      return
    }
    navigate(safeNextPath(params.get('next')), { replace: true })
  }

  return (
    <AuthLayout
      title="Sign in"
      description="Welcome back to MailPilot."
      footer={
        <span>
          No account yet?{' '}
          <Link to="/signup" className="font-medium text-foreground underline-offset-4 hover:underline">
            Create one
          </Link>
        </span>
      }
    >
      <form noValidate onSubmit={onSubmit}>
        <FieldGroup>
          {formError ? (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          ) : null}
          <TextField name="email" label="Email" type="email" autoComplete="email" required error={errors.email} />
          <TextField
            name="password"
            label="Password"
            type="password"
            autoComplete="current-password"
            required
            error={errors.password}
          />
          <div className="flex justify-end text-sm">
            <Link to="/forgot-password" className="text-muted-foreground underline-offset-4 hover:underline">
              Forgot password?
            </Link>
          </div>
          <Button type="submit" disabled={pending} className="w-full">
            {pending ? 'Signing in…' : 'Sign in'}
          </Button>
        </FieldGroup>
      </form>
    </AuthLayout>
  )
}
