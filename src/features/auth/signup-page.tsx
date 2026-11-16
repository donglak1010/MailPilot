import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { FieldGroup } from '@/components/ui/field'
import { getSupabase } from '@/lib/supabase/client'
import { authErrorMessage } from './auth-errors'
import { AuthLayout } from './auth-layout'
import { TextField } from './form-field'
import { formValue, PASSWORD_MIN, signupSchema, toFieldErrors, type FieldErrors } from './schemas'

export default function SignupPage() {
  const navigate = useNavigate()
  const [errors, setErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [confirmEmailFor, setConfirmEmailFor] = useState<string | null>(null)

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const parsed = signupSchema.safeParse({
      fullName: formValue(form, 'fullName'),
      email: formValue(form, 'email'),
      password: formValue(form, 'password'),
    })
    setFormError(null)
    if (!parsed.success) {
      setErrors(toFieldErrors(parsed.error))
      return
    }
    setErrors({})
    setPending(true)
    const { data, error } = await getSupabase().auth.signUp({
      email: parsed.data.email,
      password: parsed.data.password,
      options: {
        data: { full_name: parsed.data.fullName },
        emailRedirectTo: `${window.location.origin}/`,
      },
    })
    setPending(false)
    if (error) {
      setFormError(authErrorMessage(error))
      return
    }
    // With email confirmation enabled (production) there is no session yet.
    if (data.session) navigate('/', { replace: true })
    else setConfirmEmailFor(parsed.data.email)
  }

  if (confirmEmailFor) {
    return (
      <AuthLayout title="Check your email">
        <Alert>
          <AlertTitle>Confirm your address</AlertTitle>
          <AlertDescription>
            We sent a confirmation link to <strong>{confirmEmailFor}</strong>. Open it to activate your account.
          </AlertDescription>
        </Alert>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout
      title="Create your account"
      description="A personal workspace is created for you automatically."
      footer={
        <span>
          Already have an account?{' '}
          <Link to="/login" className="font-medium text-foreground underline-offset-4 hover:underline">
            Sign in
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
          <TextField name="fullName" label="Your name" autoComplete="name" required error={errors.fullName} />
          <TextField name="email" label="Email" type="email" autoComplete="email" required error={errors.email} />
          <TextField
            name="password"
            label="Password"
            type="password"
            autoComplete="new-password"
            required
            hint={`At least ${PASSWORD_MIN} characters.`}
            error={errors.password}
          />
          <Button type="submit" disabled={pending} className="w-full">
            {pending ? 'Creating account…' : 'Create account'}
          </Button>
        </FieldGroup>
      </form>
    </AuthLayout>
  )
}
