import { PagePlaceholder } from '@/components/layout/page-placeholder'
import { findNavItem } from '@/lib/constants/navigation'

export default function ContactsPage() {
  return (
    <PagePlaceholder
      title="Contacts"
      description={findNavItem('/contacts')?.description ?? ''}
      phase="Phase 2"
      planned={[
        'Paginated, searchable contacts table',
        'Create / edit / archive contacts with consent fields',
        'Lists and tags',
        'CSV import: upload, preview, column mapping, dedupe',
        'Export (permission-gated)'
      ]}
    />
  )
}
