import type { ComponentProps } from 'react'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'

type TextFieldProps = ComponentProps<typeof Input> & {
  name: string
  label: string
  error?: string
  hint?: string
}

/** Labelled input with accessible error wiring. */
export function TextField({ name, label, error, hint, id, ...inputProps }: TextFieldProps) {
  const inputId = id ?? `field-${name}`
  const errorId = `${inputId}-error`
  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={inputId}>{label}</FieldLabel>
      <Input
        id={inputId}
        name={name}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        {...inputProps}
      />
      {hint && !error ? <FieldDescription>{hint}</FieldDescription> : null}
      {error ? <FieldError id={errorId}>{error}</FieldError> : null}
    </Field>
  )
}
