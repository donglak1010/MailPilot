import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Copy, MoreHorizontal, Plus, Send, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/feedback/confirm-dialog'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useUser } from '@/features/auth/auth-context'
import { useWorkspace } from '@/features/workspaces/workspace-context'
import { findNavItem } from '@/lib/constants/navigation'
import { dbErrorMessage } from '@/lib/supabase/errors'
import { formatInZone } from '@/lib/timezone'
import { campaignKeys, createCampaign, deleteCampaign, useCampaigns, type CampaignListItem } from './api'
import { CampaignStatusBadge } from './components/status-badges'
import { pct } from './lib/status'

function whenLabel(c: CampaignListItem, tz: string) {
  if (c.status === 'scheduled') return `Scheduled ${formatInZone(c.scheduled_at, tz)}`
  if (c.status === 'sent') return `Sent ${formatInZone(c.completed_at, tz)}`
  if (c.status === 'sending' || c.status === 'paused') return `Started ${formatInZone(c.started_at, tz)}`
  return `Edited ${formatInZone(c.updated_at, tz)}`
}

export default function CampaignsPage() {
  const { current } = useWorkspace()
  const user = useUser()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const campaigns = useCampaigns(current.id)
  const [deleting, setDeleting] = useState<CampaignListItem | null>(null)

  const create = useMutation({
    mutationFn: (source?: CampaignListItem) =>
      createCampaign(
        current.id,
        user.id,
        source
          ? {
              name: `${source.name} (copy)`.slice(0, 200),
              subject: source.subject,
              preview_text: source.preview_text,
              from_name: source.from_name,
              from_email: source.from_email,
              reply_to: source.reply_to,
              sender_domain_id: source.sender_domain_id,
              html_body: source.html_body,
              text_body: source.text_body,
              template_id: source.template_id,
              list_ids: source.lists.map((l) => l.id),
            }
          : {
              name: 'Untitled campaign',
              from_name: current.default_from_name,
              from_email: current.default_from_email,
              reply_to: current.default_reply_to,
            },
      ),
    onSuccess: async (id) => {
      await queryClient.invalidateQueries({ queryKey: campaignKeys.list(current.id) })
      navigate(`/campaigns/${id}`)
    },
    onError: (err) => toast.error(dbErrorMessage(err, 'Could not create the campaign')),
  })

  const remove = useMutation({
    mutationFn: (c: CampaignListItem) => deleteCampaign(c.id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: campaignKeys.list(current.id) })
      toast.success('Campaign deleted')
      setDeleting(null)
    },
    onError: (err) => toast.error(dbErrorMessage(err, 'Could not delete the campaign')),
  })

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Campaigns</h1>
          <p className="text-muted-foreground text-sm">{findNavItem('/campaigns')?.description}</p>
        </div>
        <Button onClick={() => create.mutate(undefined)} disabled={create.isPending}>
          <Plus /> New campaign
        </Button>
      </div>

      {campaigns.isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : campaigns.isError ? (
        <Alert variant="destructive">
          <AlertTitle>Could not load campaigns</AlertTitle>
          <AlertDescription>{dbErrorMessage(campaigns.error)}</AlertDescription>
        </Alert>
      ) : campaigns.data.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <Send className="text-muted-foreground size-10" />
            <div>
              <p className="font-medium">No campaigns yet</p>
              <p className="text-muted-foreground max-w-md text-sm">
                A campaign is a one-off email to one or more of your lists — a launch, a promotion or a newsletter.
              </p>
            </div>
            <Button onClick={() => create.mutate(undefined)} disabled={create.isPending}>
              <Plus /> Create your first campaign
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Campaign</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Recipients</TableHead>
                <TableHead className="text-right">Delivered</TableHead>
                <TableHead className="text-right">Opened</TableHead>
                <TableHead className="text-right">Clicked</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {campaigns.data.map((c) => {
                const s = c.stats
                return (
                  <TableRow key={c.id}>
                    <TableCell className="max-w-[320px]">
                      <Link to={`/campaigns/${c.id}`} className="block truncate font-medium hover:underline">
                        {c.name}
                      </Link>
                      <div className="text-muted-foreground truncate text-xs">
                        {c.subject || 'No subject'} · {c.lists.map((l) => l.name).join(', ') || 'No lists'}
                      </div>
                      <div className="text-muted-foreground text-xs">{whenLabel(c, current.timezone)}</div>
                    </TableCell>
                    <TableCell>
                      <CampaignStatusBadge status={c.status} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{s?.total ?? '—'}</TableCell>
                    <TableCell className="text-right tabular-nums">{s ? pct(s.delivered, s.sent) : '—'}</TableCell>
                    <TableCell className="text-right tabular-nums">{s ? pct(s.opened, s.delivered) : '—'}</TableCell>
                    <TableCell className="text-right tabular-nums">{s ? pct(s.clicked, s.delivered) : '—'}</TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${c.name}`}>
                            <MoreHorizontal />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => create.mutate(c)}>
                            <Copy /> Duplicate
                          </DropdownMenuItem>
                          {c.status === 'draft' || c.status === 'cancelled' || c.status === 'failed' ? (
                            <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(c)}>
                              <Trash2 /> Delete
                            </DropdownMenuItem>
                          ) : null}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete "${deleting?.name ?? ''}"?`}
        description="The campaign and its delivery history are deleted permanently."
        confirmLabel="Delete"
        destructive
        pending={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting)}
      />
    </div>
  )
}
