import { useSearchParams } from 'react-router'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ContactsTab } from './components/contacts-tab'
import { ImportsTab } from './components/imports-tab'
import { ListsTab, TagsTab } from './components/lists-tags-tabs'

const TABS = ['contacts', 'lists', 'tags', 'imports'] as const
type TabValue = (typeof TABS)[number]

export default function ContactsPage() {
  const [params, setParams] = useSearchParams()
  const raw = params.get('tab')
  const tab: TabValue = TABS.includes(raw as TabValue) ? (raw as TabValue) : 'contacts'

  return (
    <section className="space-y-6" aria-labelledby="page-title">
      <div className="space-y-1">
        <h2 id="page-title" className="text-2xl font-semibold tracking-tight">
          Contacts
        </h2>
        <p className="text-sm text-muted-foreground">Subscribers, lists, tags and CSV imports.</p>
      </div>
      <Tabs
        value={tab}
        onValueChange={(v) => setParams(v === 'contacts' ? {} : { tab: v }, { replace: true })}
        className="space-y-4"
      >
        <TabsList>
          <TabsTrigger value="contacts">Contacts</TabsTrigger>
          <TabsTrigger value="lists">Lists</TabsTrigger>
          <TabsTrigger value="tags">Tags</TabsTrigger>
          <TabsTrigger value="imports">Imports</TabsTrigger>
        </TabsList>
        <TabsContent value="contacts">
          <ContactsTab />
        </TabsContent>
        <TabsContent value="lists">
          <ListsTab />
        </TabsContent>
        <TabsContent value="tags">
          <TagsTab />
        </TabsContent>
        <TabsContent value="imports">
          <ImportsTab />
        </TabsContent>
      </Tabs>
    </section>
  )
}
