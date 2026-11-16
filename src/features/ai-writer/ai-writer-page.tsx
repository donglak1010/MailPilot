import { PagePlaceholder } from '@/components/layout/page-placeholder'
import { findNavItem } from '@/lib/constants/navigation'

export default function AiWriterPage() {
  return (
    <PagePlaceholder
      title="AI Writer"
      description={findNavItem('/ai-writer')?.description ?? ''}
      phase="Phase 5"
      planned={[
        'Inputs: product, audience, goal, tone, language, offer, CTA',
        'Outputs: subject options, preview text, HTML/text body, follow-up angle',
        'Affiliate disclosure suggestion; human review required before use',
        'Monthly usage limit per workspace'
      ]}
    />
  )
}
