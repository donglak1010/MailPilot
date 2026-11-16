/** Time-zone helpers without a date library (Intl only). Unit-tested in timezone.test.ts. */

type Parts = { year: number; month: number; day: number; hour: number; minute: number; second: number }

function partsInZone(ms: number, timeZone: string): Parts {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const get = (type: string) => Number(fmt.formatToParts(new Date(ms)).find((p) => p.type === type)?.value ?? 0)
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute'), second: get('second') }
}

/** Offset (ms) of `timeZone` from UTC at instant `ms`. */
function offsetMs(ms: number, timeZone: string): number {
  const p = partsInZone(ms, timeZone)
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000
}

const pad = (n: number) => String(n).padStart(2, '0')

/** ISO instant → value for <input type="datetime-local"> in `timeZone` ("2026-11-16T09:30"). */
export function toZonedInput(iso: string | Date, timeZone: string): string {
  const p = partsInZone(new Date(iso).getTime(), timeZone)
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`
}

/** "2026-11-16T09:30" interpreted as wall-clock time in `timeZone` → UTC Date (null if invalid). */
export function fromZonedInput(local: string, timeZone: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local)
  if (!m) return null
  const [, y, mo, d, h, mi] = m.map(Number) as [number, number, number, number, number, number]
  const asUtc = Date.UTC(y, mo - 1, d, h, mi)
  // two passes handle DST transitions
  let guess = asUtc - offsetMs(asUtc, timeZone)
  guess = asUtc - offsetMs(guess, timeZone)
  return new Date(guess)
}

/** Human-readable date/time in the workspace time zone. */
export function formatInZone(iso: string | null | undefined, timeZone: string, opts: Intl.DateTimeFormatOptions = {}): string {
  if (!iso) return '—'
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone, ...opts }).format(new Date(iso))
  } catch {
    return new Date(iso).toLocaleString()
  }
}
