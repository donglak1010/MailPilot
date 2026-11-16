import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, CalendarClock, Pause, Play, Save, Send, SendHorizontal, Undo2, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/feedback/confirm-dialog'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useContactLists } from '@/features/contacts/api'
import { isDomainVerified, useSenderDomains } from '@/features/sender-domains/api'
import { canManageWorkspace, useWorkspace } from '@/features/workspaces/workspace-context'
import { dbErrorMessage, knownErrorMessage } from '@/lib/supabase/errors'
import { formatInZone } from '@/lib/timezone'
import {
  campaignKeys,
  cancelCampaign,
  isEditable,
  pauseCampaign,
  resumeCampaign,
  saveCampaign,
  scheduleCampaign,
  sendCampaignTest,
  startCampaign,
  unscheduleCampaign,
  useAudienceCount,
  useCampaign,
  type CampaignDetail,
  type CampaignDraft,
} from './api'
import { CampaignForm } from './components/campaign-form'
import { CampaignReport } from './components/campaign-report'
import { EmailPreview } from './components/email-preview'
import { ScheduleDialog } from './components/schedule-dialog'
import { SendChecklist, type ChecklistItem } from './components/send-checklist'
import { CampaignStatusBadge } from './components/status-badges'

const LOCAL_PART_RE = /^[a-z0-9._+-]+$/i

function toDraft(c: CampaignDetail): CampaignDraft {
  return {
    name: c.name,
    subject: c.subject,
    preview_text: c.preview_text,
    from_name: c.from_name,
    from_email: c.from_email,
    reply_to: c.reply_to,
    sender_domain_id: c.sender_domain_id,
    html_body: c.html_body,
    text_body: c.text_body,
    template_id: c.template_id,
    list_ids: [...c.list_ids].sort(),
  }
}

const sameDraft = (a: CampaignDraft, b: CampaignDraft) =>
  JSON.stringify({ ...a, list_ids: [...a.list_ids].sort() }) === JSON.stringify({ ...b, list_ids: [...b.list_ids].sort() })

function errorText(err: unknown, fallback: string) {
  return dbErrorMessage(err, err instanceof Error ? err.message : fallback)
}

export default function CampaignEditorPage() {
  const { id = '' } = useParams()
  const { current } = useWorkspace()
  const campaign = useCampaign(current.id, id)

  if (campaign.isPending) return <Skeleton className="h-96 w-full" />
  if (campaign.isError) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Campaign not found</AlertTitle>
        <AlertDescription>
          It may have been deleted, or it belongs to another workspace.{' '}
          <Link to="/campaigns" className="underline">
            Back to campaigns
          </Link>
        </AlertDescription>
      </Alert>
    )
  }
  // Re-mount the editor whenever the saved row changes so the draft starts from the latest data.
  return <Editor key={`${campaign.data.id}:${campaign.data.updated_at}`} campaign={campaign.data} />
}

function Editor({ campaign }: { campaign: CampaignDetail }) {
  const { current } = useWorkspace()
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState(() => toDraft(campaign))
  const [scheduleOpen, setScheduleOpen] = useState(false)
  const [confirm, setConfirm] = useState<'send' | 'cancel' | null>(null)

  const editable = isEditable(campaign.status)
  const canSend = canManageWorkspace(current.role)
  const dirty = editable && !sameDraft(draft, toDraft(campaign))
  const live = campaign.status === 'sending'

  const domains = useSenderDomains(current.id)
  const lists = useContactLists(current.id)
  const audience = useAudienceCount(current.id, draft.list_ids)

  const checklist = useMemo<ChecklistItem[]>(() => {
    const domain = (domains.data ?? []).find((d) => d.id === draft.sender_domain_id)
    const [local, at] = (draft.from_email ?? '').split('@')
    const senderOk = !!domain && isDomainVerified(domain) && at === domain.domain && !!local && LOCAL_PART_RE.test(local)
    return [
      { ok: senderOk, label: 'From address on a verified domain', fix: { to: '/sender-domains', label: 'Sender Domains' } },
      { ok: draft.list_ids.length > 0 && (audience.data ?? 0) > 0, label: 'At least one subscribed recipient' },
      { ok: draft.subject.trim() !== '', label: 'Subject line' },
      { ok: draft.html_body.trim() !== '', label: 'Email content' },
      { ok: draft.html_body.includes('{{unsubscribe_url}}'), label: 'Unsubscribe link ({{unsubscribe_url}})' },
      { ok: !!current.postal_address?.trim(), label: 'Postal address in the footer', fix: { to: '/settings', label: 'Settings' } },
    ]
  }, [draft, domains.data, audience.data, current.postal_address])
  const ready = checklist.every((i) => i.ok)

  const invalidate = () => queryClient.invalidateQueries({ queryKey: campaignKeys.all(current.id) })

  const save = useMutation({
    mutationFn: () => saveCampaign(current.id, campaign.id, draft, campaign.list_ids),
    onSuccess: async () => {
      await invalidate()
      toast.success('Campaign saved')
    },
    onError: (err) => toast.error(errorText(err, 'Could not save')),
  })

  /** Persist unsaved edits before an action that reads the saved row on the server. */
  async function saveIfDirty() {
    if (dirty) await saveCampaign(current.id, campaign.id, draft, campaign.list_ids)
  }

  const action = useMutation({
    mutationFn: async (fn: () => Promise<string>) => {
      await saveIfDirty()
      return fn()
    },
    onSuccess: async (message) => {
      await invalidate()
      toast.success(message)
      setConfirm(null)
      setScheduleOpen(false)
    },
    onError: async (err) => {
      await invalidate()
      toast.error(errorText(err, 'Something went wrong'))
    },
  })

  const test = useMutation({
    mutationFn: async () => {
      await saveIfDirty()
      return sendCampaignTest(current.id, campaign.id)
    },
    onSuccess: async (r) => {
      await invalidate()
      toast.success(r.mock ? 'Mock test sent (local dev — nothing delivered)' : `Test email sent to ${r.to}`)
    },
    onError: (err) => toast.error(errorText(err, 'Could not send the test')),
  })

  const busy = save.isPending || action.isPending || test.isPending
  const listNames = (lists.data ?? []).filter((l) => campaign.list_ids.includes(l.id)).map((l) => l.name)
  const sendBlockedReason = !canSend ? 'Only owners and admins can send' : !ready ? 'Complete the checklist first' : undefined

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <Link to="/campaigns" className="text-muted-foreground mb-1 inline-flex items-center gap-1 text-sm hover:underline">
            <ArrowLeft className="size-3.5" /> Campaigns
          </Link>
          <h1 className="flex flex-wrap items-center gap-2 text-2xl font-semibold tracking-tight">
            <span className="truncate">{draft.name || 'Untitled campaign'}</span>
            <CampaignStatusBadge status={campaign.status} />
            {dirty ? <span className="text-muted-foreground text-sm font-normal">Unsaved changes</span> : null}
          </h1>
          {campaign.status === 'scheduled' ? (
            <p className="text-muted-foreground text-sm">Sends {formatInZone(campaign.scheduled_at, current.timezone)} ({current.timezone})</p>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-2">
          {editable && campaign.status !== 'failed' ? (
            <>
              <Button variant="outline" onClick={() => save.mutate()} disabled={!dirty || busy}>
                <Save /> {save.isPending ? 'Saving…' : 'Save'}
              </Button>
              <Button variant="outline" onClick={() => test.mutate()} disabled={busy || !checklist[0]!.ok}>
                <Send /> {test.isPending ? 'Sending…' : 'Send test'}
              </Button>
              {campaign.status === 'scheduled' ? (
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => action.mutate(async () => (await unscheduleCampaign(campaign.id), 'Moved back to draft'))}
                >
                  <Undo2 /> Unschedule
                </Button>
              ) : null}
              <Button variant="outline" onClick={() => setScheduleOpen(true)} disabled={busy || !!sendBlockedReason} title={sendBlockedReason}>
                <CalendarClock /> {campaign.status === 'scheduled' ? 'Reschedule' : 'Schedule'}
              </Button>
              <Button onClick={() => setConfirm('send')} disabled={busy || !!sendBlockedReason} title={sendBlockedReason}>
                <SendHorizontal /> Send now
              </Button>
            </>
          ) : null}
          {campaign.status === 'failed' ? (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => action.mutate(async () => (await unscheduleCampaign(campaign.id), 'Moved back to draft'))}
            >
              <Undo2 /> Back to draft
            </Button>
          ) : null}
          {campaign.status === 'sending' ? (
            <Button variant="outline" disabled={busy} onClick={() => action.mutate(async () => (await pauseCampaign(campaign.id), 'Campaign paused'))}>
              <Pause /> Pause
            </Button>
          ) : null}
          {campaign.status === 'paused' ? (
            <Button
              disabled={busy || !canSend}
              title={canSend ? undefined : 'Only owners and admins can resume'}
              onClick={() => action.mutate(async () => (await resumeCampaign(campaign.id), 'Sending resumed'))}
            >
              <Play /> Resume
            </Button>
          ) : null}
          {campaign.status === 'sending' || campaign.status === 'paused' ? (
            <Button variant="destructive" disabled={busy} onClick={() => setConfirm('cancel')}>
              <X /> Cancel sending
            </Button>
          ) : null}
        </div>
      </div>

      {campaign.status === 'failed' ? (
        <Alert variant="destructive">
          <AlertTitle>The scheduled send could not start</AlertTitle>
          <AlertDescription>
            {knownErrorMessage(campaign.failure_reason ?? '') ?? campaign.failure_reason ?? 'Unknown error.'} Fix it, move the
            campaign back to draft and send or schedule it again.
          </AlertDescription>
        </Alert>
      ) : null}
      {campaign.status === 'paused' ? (
        <Alert>
          <AlertTitle>Paused</AlertTitle>
          <AlertDescription>No further emails are sent until you resume. Contacts already emailed are not emailed again.</AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(340px,520px)]">
        <div className="min-w-0 space-y-6">
          {editable ? (
            <CampaignForm draft={draft} onChange={(patch) => setDraft((d) => ({ ...d, ...patch }))} disabled={busy} />
          ) : (
            <>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Summary</CardTitle>
                </CardHeader>
                <CardContent>
                  <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[max-content_1fr]">
                    <dt className="text-muted-foreground">Subject</dt>
                    <dd>{campaign.subject}</dd>
                    <dt className="text-muted-foreground">From</dt>
                    <dd className="break-all">
                      {campaign.from_name} &lt;{campaign.from_email}&gt;
                    </dd>
                    <dt className="text-muted-foreground">Lists</dt>
                    <dd>{listNames.join(', ') || '—'}</dd>
                    <dt className="text-muted-foreground">Started</dt>
                    <dd>{formatInZone(campaign.started_at, current.timezone)}</dd>
                    <dt className="text-muted-foreground">Finished</dt>
                    <dd>{formatInZone(campaign.completed_at, current.timezone)}</dd>
                  </dl>
                </CardContent>
              </Card>
              <CampaignReport campaignId={campaign.id} live={live} />
            </>
          )}
        </div>

        <div className="min-w-0 space-y-6">
          {editable ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Ready to send?</CardTitle>
              </CardHeader>
              <CardContent>
                <SendChecklist items={checklist} />
              </CardContent>
            </Card>
          ) : null}
          <EmailPreview draft={draft} postalAddress={current.postal_address} />
        </div>
      </div>

      <ScheduleDialog
        open={scheduleOpen}
        onOpenChange={setScheduleOpen}
        timeZone={current.timezone}
        initial={campaign.status === 'scheduled' ? campaign.scheduled_at : null}
        pending={action.isPending}
        onSchedule={(at) =>
          action.mutate(async () => {
            await scheduleCampaign(campaign.id, at)
            return `Scheduled for ${formatInZone(at.toISOString(), current.timezone)}`
          })
        }
      />
      <ConfirmDialog
        open={confirm === 'send'}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Send this campaign now?"
        description={`It will be sent to ${audience.data ?? '…'} subscribed contacts. Emails go out gradually; you can pause or cancel while it is sending.`}
        confirmLabel="Send now"
        pending={action.isPending}
        onConfirm={() => action.mutate(async () => `Sending to ${await startCampaign(campaign.id)} contacts`)}
      />
      <ConfirmDialog
        open={confirm === 'cancel'}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Cancel sending?"
        description="Emails not yet sent are cancelled permanently. Emails already sent cannot be recalled."
        confirmLabel="Cancel sending"
        destructive
        pending={action.isPending}
        onConfirm={() => action.mutate(async () => (await cancelCampaign(campaign.id), 'Campaign cancelled'))}
      />
    </div>
  )
}
