import { describe, expect, it } from 'vitest'
import { fromZonedInput, toZonedInput } from './timezone'

describe('time-zone conversion', () => {
  it('converts wall-clock time in Vietnam (UTC+7, no DST)', () => {
    expect(fromZonedInput('2026-11-20T09:00', 'Asia/Ho_Chi_Minh')!.toISOString()).toBe('2026-11-20T02:00:00.000Z')
    expect(toZonedInput('2026-11-20T02:00:00Z', 'Asia/Ho_Chi_Minh')).toBe('2026-11-20T09:00')
  })

  it('handles DST zones on both sides of the change', () => {
    expect(fromZonedInput('2026-07-01T12:00', 'America/New_York')!.toISOString()).toBe('2026-07-01T16:00:00.000Z')
    expect(fromZonedInput('2026-12-01T12:00', 'America/New_York')!.toISOString()).toBe('2026-12-01T17:00:00.000Z')
  })

  it('round-trips and rejects malformed input', () => {
    const local = '2027-03-05T23:45'
    expect(toZonedInput(fromZonedInput(local, 'Europe/Berlin')!, 'Europe/Berlin')).toBe(local)
    expect(fromZonedInput('2026-11-20 09:00', 'UTC')).toBeNull()
  })
})
