import { PagePlaceholder } from '@/components/layout/page-placeholder'
import { findNavItem } from '@/lib/constants/navigation'

export default function SenderDomainsPage() {
  return (
    <PagePlaceholder
      title="Sender Domains"
      description={findNavItem('/sender-domains')?.description ?? ''}
      phase="Phase 3"
      planned={[
        'Add domain/subdomain and create SES identity',
        'DNS records checklist (DKIM, SPF, DMARC, MAIL FROM)',
        'Refresh verification status'
      ]}
    />
  )
}
