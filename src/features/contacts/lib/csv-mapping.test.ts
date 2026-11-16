import { describe, expect, it } from 'vitest'
import { buildRows, chunk, guessMapping, guessNameOrder, toCustomKey, validateMapping } from './csv-mapping'

describe('guessMapping', () => {
  it('detects common header variants', () => {
    expect(guessMapping(['E-mail Address', 'First Name', 'Surname', 'Plan'])).toEqual({
      'E-mail Address': { kind: 'email' },
      'First Name': { kind: 'first_name' },
      Surname: { kind: 'last_name' },
      Plan: { kind: 'ignore' },
    })
  })

  it('maps a single name column to full_name', () => {
    expect(guessMapping(['email', 'Name'])).toEqual({ email: { kind: 'email' }, Name: { kind: 'full_name' } })
  })

  it('falls back to any header containing "email"', () => {
    expect(guessMapping(['Buyer Email (primary)', 'x'])['Buyer Email (primary)']).toEqual({ kind: 'email' })
  })

  it('assigns each standard field only once', () => {
    const m = guessMapping(['email', 'Email Address'])
    expect(Object.values(m).filter((t) => t.kind === 'email')).toHaveLength(1)
  })
})

describe('validateMapping', () => {
  it('requires exactly one email column', () => {
    expect(validateMapping({ a: { kind: 'ignore' } })).toContain('no_email')
    expect(validateMapping({ a: { kind: 'email' }, b: { kind: 'email' } })).toContain('multiple_email')
    expect(validateMapping({ a: { kind: 'email' } })).toEqual([])
  })

  it('rejects duplicate custom keys', () => {
    expect(
      validateMapping({ e: { kind: 'email' }, a: { kind: 'custom', key: 'plan' }, b: { kind: 'custom', key: 'plan' } }),
    ).toContain('duplicate_custom_key')
  })
})

describe('toCustomKey', () => {
  it('produces ascii snake_case keys', () => {
    expect(toCustomKey('Ngày mua hàng')).toBe('ngay_mua_hang')
    expect(toCustomKey('  Product (SKU) #  ')).toBe('product_sku')
    expect(toCustomKey('Đơn hàng')).toBe('don_hang')
    expect(toCustomKey('!!!')).toBe('field')
  })
})

describe('buildRows', () => {
  it('maps, trims, splits full names and collects custom fields', () => {
    const rows = buildRows(
      [
        { Email: ' a@example.com ', Name: 'Nguyen Van An', Plan: 'pro', Junk: 'x' },
        { Email: 'b@example.com', Name: '', Plan: '' },
      ],
      {
        Email: { kind: 'email' },
        Name: { kind: 'full_name' },
        Plan: { kind: 'custom', key: 'plan' },
        Junk: { kind: 'ignore' },
      },
    )
    expect(rows).toEqual([
      { email: 'a@example.com', first_name: 'Nguyen Van', last_name: 'An', custom_fields: { plan: 'pro' } },
      { email: 'b@example.com' },
    ])
  })

  it('prefers explicit first/last columns over full name', () => {
    const rows = buildRows([{ f: 'Bao', n: 'Tran Bao' }], { f: { kind: 'first_name' }, n: { kind: 'full_name' } })
    expect(rows[0]).toEqual({ email: '', first_name: 'Bao', last_name: 'Bao' })
  })
})

describe('Vietnamese names', () => {
  it('maps a "Họ tên" header to family-first order', () => {
    expect(guessMapping(['Email', 'Họ tên'])['Họ tên']).toEqual({ kind: 'full_name_vn' })
  })

  it('splits family-first names so {{first_name}} is the given name', () => {
    const rows = buildRows([{ e: 'm@example.com', n: 'Nguyễn Văn Minh' }], {
      e: { kind: 'email' },
      n: { kind: 'full_name_vn' },
    })
    expect(rows[0]).toEqual({ email: 'm@example.com', first_name: 'Minh', last_name: 'Nguyễn Văn' })
  })

  it('guesses name order from sample values', () => {
    expect(guessNameOrder(['Nguyễn Văn Minh', 'Trần Thị Lan', 'Lê Hoa', 'Alice Smith'])).toBe('full_name_vn')
    expect(guessNameOrder(['Alice Smith', 'Bob Jones', 'Nguyễn Minh'])).toBe('full_name')
    expect(guessNameOrder(['Madonna', '', undefined])).toBe('full_name')
  })

  it('recognises decomposed (NFD) Vietnamese input', () => {
    expect(guessNameOrder(['Nguyễn Văn Minh'.normalize('NFD'), 'Phạm Thu Hà'.normalize('NFD')])).toBe('full_name_vn')
  })
})

describe('chunk', () => {
  it('splits into fixed-size batches', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
    expect(chunk([], 3)).toEqual([])
  })
})
