import { PagePlaceholder } from '@/components/layout/page-placeholder'
import { findNavItem } from '@/lib/constants/navigation'

export default function SequencesPage() {
  return (
    <PagePlaceholder
      title="Sequences"
      description={findNavItem('/sequences')?.description ?? ''}
      phase="Phase 5"
      planned={[
        'Sequence list and ordered step editor with delays',
        'Manual and list-join enrollment',
        'Enrollment status; unsubscribe stops future steps'
      ]}
    />
  )
}
