import { PagePlaceholder } from '@/components/layout/page-placeholder'
import { findNavItem } from '@/lib/constants/navigation'

export default function TemplatesPage() {
  return (
    <PagePlaceholder
      title="Templates"
      description={findNavItem('/templates')?.description ?? ''}
      phase="Phase 5"
      planned={[
        'System templates: welcome, product launch, affiliate, follow-up',
        'Workspace templates with merge tags ({{first_name}}, {{unsubscribe_url}})'
      ]}
    />
  )
}
