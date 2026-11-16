import { CircleCheck, CircleDashed, CircleX, Info, LoaderCircle } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import type { DomainStatus } from '../api'

const STATUS: Record<DomainStatus | 'recommended', { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  verified: { label: 'Verified', variant: 'default' },
  pending: { label: 'Pending', variant: 'outline' },
  not_started: { label: 'Not started', variant: 'outline' },
  temporary_failure: { label: 'Temporary failure', variant: 'secondary' },
  failed: { label: 'Failed', variant: 'destructive' },
  recommended: { label: 'Recommended', variant: 'secondary' },
}

export function DomainStatusBadge({ status }: { status: DomainStatus | 'recommended' }) {
  const s = STATUS[status]
  return <Badge variant={s.variant}>{s.label}</Badge>
}

export function StatusIcon({ status }: { status: DomainStatus | 'recommended' }) {
  switch (status) {
    case 'verified':
      return <CircleCheck className="size-4 text-emerald-600 dark:text-emerald-400" aria-label="Verified" />
    case 'failed':
      return <CircleX className="text-destructive size-4" aria-label="Failed" />
    case 'temporary_failure':
      return <LoaderCircle className="size-4 text-amber-600" aria-label="Temporary failure" />
    case 'recommended':
      return <Info className="text-muted-foreground size-4" aria-label="Recommended" />
    default:
      return <CircleDashed className="text-muted-foreground size-4" aria-label="Pending" />
  }
}
