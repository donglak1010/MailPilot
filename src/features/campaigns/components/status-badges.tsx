import { Badge } from '@/components/ui/badge'
import type { CampaignStatus, SendStatus } from '../api'
import { CAMPAIGN_STATUS, SEND_STATUS } from '../lib/status'

export function CampaignStatusBadge({ status }: { status: CampaignStatus }) {
  const s = CAMPAIGN_STATUS[status]
  return <Badge variant={s.variant}>{s.label}</Badge>
}

export function SendStatusBadge({ status }: { status: SendStatus }) {
  const s = SEND_STATUS[status]
  return (
    <Badge variant={s.variant} title={s.hint}>
      {s.label}
    </Badge>
  )
}
