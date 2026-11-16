import type { CampaignStatus, SendStatus } from '../api'

type Variant = 'default' | 'secondary' | 'destructive' | 'outline'

export const CAMPAIGN_STATUS: Record<CampaignStatus, { label: string; variant: Variant }> = {
  draft: { label: 'Draft', variant: 'outline' },
  scheduled: { label: 'Scheduled', variant: 'secondary' },
  sending: { label: 'Sending', variant: 'default' },
  paused: { label: 'Paused', variant: 'secondary' },
  sent: { label: 'Sent', variant: 'default' },
  cancelled: { label: 'Cancelled', variant: 'outline' },
  failed: { label: 'Failed', variant: 'destructive' },
}

export const SEND_STATUS: Record<SendStatus, { label: string; variant: Variant; hint?: string }> = {
  pending: { label: 'Pending', variant: 'outline' },
  queued: { label: 'Queued', variant: 'outline' },
  sending: { label: 'Sending', variant: 'secondary' },
  sent: { label: 'Sent', variant: 'secondary' },
  delivered: { label: 'Delivered', variant: 'default' },
  bounced: { label: 'Bounced', variant: 'destructive' },
  complained: { label: 'Complained', variant: 'destructive' },
  failed: { label: 'Failed', variant: 'destructive' },
  skipped: { label: 'Skipped', variant: 'outline', hint: 'Not sent: the contact was unsubscribed or suppressed before sending.' },
  cancelled: { label: 'Cancelled', variant: 'outline' },
  ambiguous: {
    label: 'Unconfirmed',
    variant: 'secondary',
    hint: 'The send was interrupted and we could not confirm whether SES accepted it. It is never retried automatically.',
  },
}

export const SEND_STATUSES = Object.keys(SEND_STATUS) as SendStatus[]

export const pct = (part: number | null | undefined, whole: number | null | undefined) =>
  whole ? `${Math.round(((part ?? 0) / whole) * 1000) / 10}%` : '—'
