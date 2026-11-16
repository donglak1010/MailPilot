import { z } from 'zod'

export const PASSWORD_MIN = 8

const email = z.email('Enter a valid email address').trim().toLowerCase()
const password = z.string().min(PASSWORD_MIN, `Use at least ${PASSWORD_MIN} characters`).max(72, 'Use at most 72 characters')

export const loginSchema = z.object({
  email,
  password: z.string().min(1, 'Enter your password'),
})

export const signupSchema = z.object({
  fullName: z.string().trim().min(1, 'Enter your name').max(120),
  email,
  password,
})

export const forgotPasswordSchema = z.object({ email })

export const resetPasswordSchema = z
  .object({ password, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'Passwords do not match' })

export type FieldErrors = Partial<Record<string, string>>

/** Flatten a Zod error into { field: firstMessage }. */
export function toFieldErrors(error: z.ZodError): FieldErrors {
  const out: FieldErrors = {}
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? 'form')
    out[key] ??= issue.message
  }
  return out
}

/** Read a string field from a submitted form. */
export function formValue(form: FormData, name: string): string {
  const v = form.get(name)
  return typeof v === 'string' ? v : ''
}
