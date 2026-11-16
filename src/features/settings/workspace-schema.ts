import { z } from 'zod'

const optionalEmail = z
  .string()
  .trim()
  .toLowerCase()
  .refine((v) => v === '' || z.email().safeParse(v).success, 'Enter a valid email address')
  .transform((v) => (v === '' ? null : v))

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use at most ${max} characters`)
    .transform((v) => (v === '' ? null : v))

/** Fields a workspace owner/admin may edit (matches the column grants in the DB). */
export const workspaceSettingsSchema = z.object({
  name: z.string().trim().min(1, 'Enter a workspace name').max(120),
  timezone: z.string().refine((tz) => {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: tz })
      return true
    } catch {
      return false
    }
  }, 'Choose a valid timezone'),
  default_from_name: optionalText(120),
  default_from_email: optionalEmail,
  default_reply_to: optionalEmail,
  postal_address: optionalText(500),
})

export type WorkspaceSettingsInput = z.infer<typeof workspaceSettingsSchema>

/**
 * IANA zones for the picker. Browsers return ICU canonical names, which can
 * differ from stored values (Chrome lists "Asia/Saigon", not "Asia/Ho_Chi_Minh"),
 * so the current value and common aliases are always included — otherwise the
 * <select> would silently fall back to the first option and overwrite it on save.
 */
export function listTimezones(current?: string): string[] {
  let zones: string[]
  try {
    zones = Intl.supportedValuesOf('timeZone')
  } catch {
    zones = ['America/New_York', 'Europe/London']
  }
  const set = new Set<string>(['UTC', 'Asia/Ho_Chi_Minh', ...zones])
  if (current) set.add(current)
  const rest = [...set].filter((tz) => tz !== 'UTC').sort()
  return ['UTC', ...rest]
}
