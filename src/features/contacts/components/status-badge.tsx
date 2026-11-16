import { Badge } from '@/components/ui/badge'
import type { ContactStatus } from '../api'
import { STATUS_STYLES } from '../lib/status'

export function StatusBadge({ status }: { status: ContactStatus }) {
  const s = STATUS_STYLES[status]
  return <Badge variant={s.variant}>{s.label}</Badge>
}

export function TagChip({ name, color }: { name: string; color: string | null }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs">
      <span className="size-2 rounded-full" style={{ backgroundColor: color ?? 'var(--muted-foreground)' }} aria-hidden />
      {name}
    </span>
  )
}
