import { Link } from 'react-router'
import { useState } from 'react'
import { ConfirmDialog } from '@/components/feedback/confirm-dialog'
import { NativeSelect } from '@/components/form/native-select'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useContactLists } from '@/features/contacts/api'
import { isDomainVerified, useSenderDomains } from '@/features/sender-domains/api'
import { useWorkspace } from '@/features/workspaces/workspace-context'
import { useAudienceCount, useTemplates, type CampaignDraft, type EmailTemplate } from '../api'

type Props = {
  draft: CampaignDraft
  onChange: (patch: Partial<CampaignDraft>) => void
  disabled: boolean
}

const MERGE_TAGS = ['{{first_name}}', '{{first_name|there}}', '{{last_name}}', '{{email}}', '{{unsubscribe_url}}', '{{postal_address}}']

export function CampaignForm({ draft, onChange, disabled }: Props) {
  return (
    <fieldset disabled={disabled} className="contents">
      <DetailsCard draft={draft} onChange={onChange} />
      <SenderCard draft={draft} onChange={onChange} />
      <AudienceCard draft={draft} onChange={onChange} disabled={disabled} />
      <ContentCard draft={draft} onChange={onChange} disabled={disabled} />
    </fieldset>
  )
}

function DetailsCard({ draft, onChange }: Omit<Props, 'disabled'>) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Details</CardTitle>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="c-name">Campaign name</FieldLabel>
            <Input id="c-name" value={draft.name} maxLength={200} onChange={(e) => onChange({ name: e.target.value })} />
            <FieldDescription>Internal only — recipients never see it.</FieldDescription>
          </Field>
        </FieldGroup>
      </CardContent>
    </Card>
  )
}

function SenderCard({ draft, onChange }: Omit<Props, 'disabled'>) {
  const { current } = useWorkspace()
  const domains = useSenderDomains(current.id)
  const verified = (domains.data ?? []).filter(isDomainVerified)
  const selected = verified.find((d) => d.id === draft.sender_domain_id)
  const [local, domainPart] = (draft.from_email ?? '').split('@') as [string, string | undefined]

  function setDomain(id: string) {
    const d = verified.find((x) => x.id === id)
    onChange({ sender_domain_id: d?.id ?? null, from_email: d ? `${local || 'hello'}@${d.domain}` : draft.from_email })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Sender</CardTitle>
        <CardDescription>Who the email comes from. Only verified domains can send.</CardDescription>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          {verified.length === 0 && !domains.isPending ? (
            <p className="text-sm">
              No verified sending domain yet.{' '}
              <Link to="/sender-domains" className="underline underline-offset-2">
                Set one up in Sender Domains
              </Link>
              .
            </p>
          ) : (
            <Field>
              <FieldLabel htmlFor="c-from-local">From address</FieldLabel>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  id="c-from-local"
                  className="w-40"
                  value={local}
                  onChange={(e) => {
                    const v = e.target.value.trim().toLowerCase()
                    onChange({ from_email: `${v}@${selected?.domain ?? domainPart ?? ''}` })
                  }}
                />
                <span className="text-muted-foreground">@</span>
                <NativeSelect
                  aria-label="Sending domain"
                  className="w-auto min-w-48"
                  value={selected?.id ?? ''}
                  onChange={(e) => setDomain(e.target.value)}
                >
                  <option value="">Choose a domain…</option>
                  {verified.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.domain}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            </Field>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="c-from-name">From name</FieldLabel>
              <Input
                id="c-from-name"
                maxLength={120}
                value={draft.from_name ?? ''}
                onChange={(e) => onChange({ from_name: e.target.value || null })}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="c-reply-to">Reply-To</FieldLabel>
              <Input
                id="c-reply-to"
                type="email"
                value={draft.reply_to ?? ''}
                placeholder="you@yourbrand.com"
                onChange={(e) => onChange({ reply_to: e.target.value.trim() || null })}
              />
            </Field>
          </div>
        </FieldGroup>
      </CardContent>
    </Card>
  )
}

function AudienceCard({ draft, onChange, disabled }: Props) {
  const { current } = useWorkspace()
  const lists = useContactLists(current.id)
  const audience = useAudienceCount(current.id, draft.list_ids)

  function toggle(id: string, on: boolean) {
    onChange({ list_ids: on ? [...draft.list_ids, id] : draft.list_ids.filter((l) => l !== id) })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Audience</CardTitle>
        <CardDescription>
          {draft.list_ids.length === 0
            ? 'Choose one or more lists.'
            : `${audience.data ?? '…'} subscribed contacts will receive this email (duplicates and suppressed addresses are removed).`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {lists.isPending ? (
          <p className="text-muted-foreground text-sm">Loading lists…</p>
        ) : (lists.data ?? []).length === 0 ? (
          <p className="text-sm">
            No lists yet.{' '}
            <Link to="/contacts?tab=lists" className="underline underline-offset-2">
              Create a list
            </Link>{' '}
            and add contacts to it.
          </p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {lists.data!.map((l) => (
              <li key={l.id}>
                <label className="hover:bg-muted/50 flex cursor-pointer items-center gap-2 rounded-md border p-2 text-sm">
                  <Checkbox
                    checked={draft.list_ids.includes(l.id)}
                    onCheckedChange={(v) => toggle(l.id, v === true)}
                    disabled={disabled}
                  />
                  <span className="min-w-0 flex-1 truncate">{l.name}</span>
                  <span className="text-muted-foreground tabular-nums">{l.member_count}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

function ContentCard({ draft, onChange, disabled }: Props) {
  const { current } = useWorkspace()
  const templates = useTemplates(current.id)
  const [pending, setPending] = useState<EmailTemplate | null>(null)

  function applyTemplate(t: EmailTemplate) {
    onChange({
      template_id: t.id,
      subject: t.subject,
      preview_text: t.preview_text,
      html_body: t.html_body,
      text_body: t.text_body,
    })
  }

  function chooseTemplate(id: string) {
    const t = templates.data?.find((x) => x.id === id)
    if (!t) return
    if (draft.html_body.trim() || draft.subject.trim()) setPending(t)
    else applyTemplate(t)
  }

  const missingUnsub = draft.html_body.trim() !== '' && !draft.html_body.includes('{{unsubscribe_url}}')

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Content</CardTitle>
        <CardDescription>
          Merge tags: {MERGE_TAGS.map((t) => <code key={t} className="mr-1 text-xs">{t}</code>)}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="c-template">Start from a template</FieldLabel>
            <NativeSelect id="c-template" value="" onChange={(e) => chooseTemplate(e.target.value)} disabled={disabled}>
              <option value="">Choose a template…</option>
              {(templates.data ?? []).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.workspace_id ? '' : '★ '}
                  {t.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field>
            <FieldLabel htmlFor="c-subject">Subject</FieldLabel>
            <Input id="c-subject" maxLength={250} value={draft.subject} onChange={(e) => onChange({ subject: e.target.value })} />
          </Field>
          <Field>
            <FieldLabel htmlFor="c-preview">Preview text</FieldLabel>
            <Input
              id="c-preview"
              maxLength={250}
              value={draft.preview_text}
              onChange={(e) => onChange({ preview_text: e.target.value })}
            />
            <FieldDescription>Shown next to the subject in most inboxes.</FieldDescription>
          </Field>
          <Field data-invalid={missingUnsub ? true : undefined}>
            <FieldLabel htmlFor="c-html">HTML body</FieldLabel>
            <Textarea
              id="c-html"
              className="min-h-72 font-mono text-xs"
              value={draft.html_body}
              onChange={(e) => onChange({ html_body: e.target.value })}
              spellCheck={false}
            />
            {missingUnsub ? (
              <FieldDescription className="text-destructive">
                Add a link to <code>{'{{unsubscribe_url}}'}</code> — it is required in every marketing email.
              </FieldDescription>
            ) : null}
          </Field>
          <Field>
            <FieldLabel htmlFor="c-text">Plain-text version (optional)</FieldLabel>
            <Textarea
              id="c-text"
              className="min-h-32 font-mono text-xs"
              value={draft.text_body}
              onChange={(e) => onChange({ text_body: e.target.value })}
            />
            <FieldDescription>Generated from the HTML when left empty.</FieldDescription>
          </Field>
        </FieldGroup>
      </CardContent>
      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(o) => !o && setPending(null)}
        title="Replace the current content?"
        description={`The subject and body will be replaced with the "${pending?.name ?? ''}" template.`}
        confirmLabel="Replace"
        onConfirm={() => {
          if (pending) applyTemplate(pending)
          setPending(null)
        }}
      />
    </Card>
  )
}
