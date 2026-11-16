import type { ContactStatus } from '../api'

export const STATUS_STYLES: Record<ContactStatus, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  subscribed: { label: 'Subscribed', variant: 'default' },
  pending: { label: 'Pending', variant: 'outline' },
  unsubscribed: { label: 'Unsubscribed', variant: 'secondary' },
  bounced: { label: 'Bounced', variant: 'destructive' },
  complained: { label: 'Complained', variant: 'destructive' },
}

export const CONTACT_STATUSES = Object.keys(STATUS_STYLES) as ContactStatus[]

export function statusLabel(status: ContactStatus) {
  return STATUS_STYLES[status].label
}
