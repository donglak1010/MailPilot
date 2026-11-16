import { PagePlaceholder } from '@/components/layout/page-placeholder'
import { findNavItem } from '@/lib/constants/navigation'

export default function CampaignsPage() {
  return (
    <PagePlaceholder
      title="Campaigns"
      description={findNavItem('/campaigns')?.description ?? ''}
      phase="Phase 4"
      planned={[
        'Campaign editor: details → audience → content → preview/test → schedule',
        'Send now or schedule in workspace timezone',
        'Pause / cancel',
        'Per-campaign delivery and engagement summary'
      ]}
    />
  )
}
