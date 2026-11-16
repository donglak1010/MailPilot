import { PagePlaceholder } from '@/components/layout/page-placeholder'
import { findNavItem } from '@/lib/constants/navigation'

export default function ReportsPage() {
  return (
    <PagePlaceholder
      title="Reports"
      description={findNavItem('/reports')?.description ?? ''}
      phase="Phase 4"
      planned={[
        'Sent, delivered, bounced, complained, opened, clicked',
        'Opens/clicks shown as approximate signals'
      ]}
    />
  )
}
