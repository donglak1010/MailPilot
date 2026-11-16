import { PagePlaceholder } from '@/components/layout/page-placeholder'
import { findNavItem } from '@/lib/constants/navigation'

export default function SettingsPage() {
  return (
    <PagePlaceholder
      title="Settings"
      description={findNavItem('/settings')?.description ?? ''}
      phase="Phase 1"
      planned={[
        'Workspace name, timezone, postal address',
        'Default From / Reply-To',
        'Members and roles',
        'Usage vs. limits'
      ]}
    />
  )
}
