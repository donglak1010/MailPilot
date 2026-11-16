/** Pure helpers for the CSV import wizard (unit-tested in csv-mapping.test.ts). */

export const IMPORT_LIMITS = {
  maxFileBytes: 10 * 1024 * 1024, // matches the storage bucket limit
  maxRows: 50_000, // matches start_contact_import
  batchSize: 500, // rows per import_contacts_batch call (server max 1000)
  maxCustomFields: 20,
} as const

export type ColumnTarget =
  | { kind: 'email' }
  | { kind: 'first_name' }
  | { kind: 'last_name' }
  | { kind: 'full_name' } // "First Last" (given name first)
  | { kind: 'full_name_vn' } // "Họ Đệm Tên" (family name first)
  | { kind: 'custom'; key: string }
  | { kind: 'ignore' }

export type ColumnMapping = Record<string, ColumnTarget>

export type ImportRow = {
  email: string
  first_name?: string
  last_name?: string
  custom_fields?: Record<string, string>
}

const normalizeHeader = (h: string) => h.trim().toLowerCase().replace(/[\s_\-.]+/g, ' ')

const EMAIL_HEADERS = new Set(['email', 'e mail', 'email address', 'e mail address', 'mail', 'subscriber email'])
const FIRST_HEADERS = new Set(['first name', 'firstname', 'fname', 'given name', 'first'])
const LAST_HEADERS = new Set(['last name', 'lastname', 'lname', 'surname', 'family name', 'last'])
const FULL_HEADERS = new Set(['name', 'full name', 'fullname', 'customer name', 'buyer name'])
const FULL_VN_HEADERS = new Set(['ho ten', 'họ tên', 'ho va ten', 'họ và tên', 'ten khach hang', 'tên khách hàng'])

// Most common Vietnamese family names (~90% of the population)
const VN_FAMILY_NAMES = new Set(
  ['nguyễn', 'trần', 'lê', 'phạm', 'hoàng', 'huỳnh', 'phan', 'vũ', 'võ', 'đặng', 'bùi', 'đỗ', 'hồ', 'ngô', 'dương', 'lý', 'đinh', 'trương', 'lâm', 'mai', 'trịnh', 'đào', 'cao', 'lưu', 'tạ', 'hà'].map((n) => n.normalize('NFC')),
)

/** snake_case key for custom fields, ASCII only, <= 40 chars. */
export function toCustomKey(header: string): string {
  const key = header
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)
  return key || 'field'
}

/** Best-guess mapping from CSV headers. Only the first matching column gets each standard field. */
export function guessMapping(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {}
  const taken = new Set<string>()
  const claim = (kind: 'email' | 'first_name' | 'last_name' | 'full_name') => {
    if (taken.has(kind)) return false
    taken.add(kind)
    return true
  }
  for (const header of headers) {
    const n = normalizeHeader(header)
    if (EMAIL_HEADERS.has(n) && claim('email')) mapping[header] = { kind: 'email' }
    else if (FIRST_HEADERS.has(n) && claim('first_name')) mapping[header] = { kind: 'first_name' }
    else if (LAST_HEADERS.has(n) && claim('last_name')) mapping[header] = { kind: 'last_name' }
    else if (FULL_VN_HEADERS.has(n) && claim('full_name')) mapping[header] = { kind: 'full_name_vn' }
    else if (FULL_HEADERS.has(n) && claim('full_name')) mapping[header] = { kind: 'full_name' }
    else mapping[header] = { kind: 'ignore' }
  }
  // fall back to any header containing "email"
  if (!taken.has('email')) {
    const candidate = headers.find((h) => normalizeHeader(h).includes('email'))
    if (candidate) mapping[candidate] = { kind: 'email' }
  }
  return mapping
}

export type MappingProblem = 'no_email' | 'multiple_email' | 'too_many_custom' | 'duplicate_custom_key'

export function validateMapping(mapping: ColumnMapping): MappingProblem[] {
  const targets = Object.values(mapping)
  const problems: MappingProblem[] = []
  const emails = targets.filter((t) => t.kind === 'email').length
  if (emails === 0) problems.push('no_email')
  if (emails > 1) problems.push('multiple_email')
  const customKeys = targets.flatMap((t) => (t.kind === 'custom' ? [t.key] : []))
  if (customKeys.length > IMPORT_LIMITS.maxCustomFields) problems.push('too_many_custom')
  if (new Set(customKeys).size !== customKeys.length) problems.push('duplicate_custom_key')
  return problems
}

/**
 * Pick the name order for a full-name column from sample values: if most
 * samples start with a common Vietnamese family name, use family-first order.
 */
export function guessNameOrder(samples: (string | undefined)[]): 'full_name' | 'full_name_vn' {
  const names = samples.map((v) => v?.trim()).filter((v): v is string => !!v && v.includes(' ')).slice(0, 50)
  if (names.length === 0) return 'full_name'
  const vn = names.filter((n) => VN_FAMILY_NAMES.has(n.split(/\s+/)[0]!.toLowerCase().normalize('NFC'))).length
  return vn / names.length >= 0.5 ? 'full_name_vn' : 'full_name'
}

/** Vietnamese order: "Nguyễn Văn Minh" -> first (given) "Minh", last (family + middle) "Nguyễn Văn". */
function splitFullNameVn(full: string): { first?: string; last?: string } {
  const parts = full.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return {}
  if (parts.length === 1) return { first: parts[0] }
  return { first: parts[parts.length - 1], last: parts.slice(0, -1).join(' ') }
}

function splitFullName(full: string): { first?: string; last?: string } {
  const parts = full.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return {}
  if (parts.length === 1) return { first: parts[0] }
  return { first: parts.slice(0, -1).join(' '), last: parts[parts.length - 1] }
}

const clip = (v: string, max: number) => v.trim().slice(0, max)

/** Convert parsed CSV records into server rows. Validation of emails happens server-side. */
export function buildRows(records: Record<string, string | undefined>[], mapping: ColumnMapping): ImportRow[] {
  const entries = Object.entries(mapping).filter(([, t]) => t.kind !== 'ignore')
  return records.map((record) => {
    const row: ImportRow = { email: '' }
    const custom: Record<string, string> = {}
    for (const [header, target] of entries) {
      const raw = record[header]
      const value = typeof raw === 'string' ? raw.trim() : ''
      if (!value) continue
      switch (target.kind) {
        case 'email':
          row.email = clip(value, 320)
          break
        case 'first_name':
          row.first_name = clip(value, 120)
          break
        case 'last_name':
          row.last_name = clip(value, 120)
          break
        case 'full_name':
        case 'full_name_vn': {
          const { first, last } = target.kind === 'full_name_vn' ? splitFullNameVn(value) : splitFullName(value)
          if (first && !row.first_name) row.first_name = clip(first, 120)
          if (last && !row.last_name) row.last_name = clip(last, 120)
          break
        }
        case 'custom':
          custom[target.key] = clip(value, 500)
          break
      }
    }
    if (Object.keys(custom).length > 0) row.custom_fields = custom
    return row
  })
}

export function chunk<T>(items: T[], size: number): T[][] {
  if (size < 1) throw new Error('chunk size must be >= 1')
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

export const SKIP_REASON_LABELS: Record<string, string> = {
  invalid_email: 'Invalid email',
  duplicate_in_file: 'Duplicate in file',
  suppressed: 'Suppressed (unsubscribed, bounced or complained)',
  contact_limit: 'Contact limit reached',
  conflict: 'Changed concurrently — retry',
}
