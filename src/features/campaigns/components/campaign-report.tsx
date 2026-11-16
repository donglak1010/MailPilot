import { useState } from 'react'
import { NativeSelect } from '@/components/form/native-select'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useWorkspace } from '@/features/workspaces/workspace-context'
import { formatInZone } from '@/lib/timezone'
import { SENDS_PAGE_SIZE, useCampaignSends, useCampaignStats, type SendStatus } from '../api'
import { pct, SEND_STATUS, SEND_STATUSES } from '../lib/status'
import { SendStatusBadge } from './status-badges'

function Stat({ label, value, sub }: { label: string; value: number | string; sub?: string }) {
  return (
    <div className="rounded-md border p-3">
      <div className="text-muted-foreground text-xs">{label}</div>
      <div className="text-xl font-semibold tabular-nums">{value}</div>
      {sub ? <div className="text-muted-foreground text-xs tabular-nums">{sub}</div> : null}
    </div>
  )
}

export function CampaignReport({ campaignId, live }: { campaignId: string; live: boolean }) {
  const { current } = useWorkspace()
  const stats = useCampaignStats(current.id, campaignId, live)
  const [status, setStatus] = useState<SendStatus | 'all'>('all')
  const [page, setPage] = useState(0)
  const sends = useCampaignSends(current.id, campaignId, status, page, live)
  const s = stats.data

  const total = s?.total ?? 0
  const done = total - (s?.in_progress ?? 0)

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Results</CardTitle>
          <CardDescription>
            Opens are estimates (image blocking and privacy features hide or inflate them). Clicks are more reliable.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {stats.isPending ? (
            <Skeleton className="h-24 w-full" />
          ) : !s ? (
            <p className="text-muted-foreground text-sm">No recipients yet.</p>
          ) : (
            <>
              {live ? (
                <div className="space-y-1">
                  <div className="flex justify-between text-sm">
                    <span>Sending…</span>
                    <span className="tabular-nums">
                      {done} / {total}
                    </span>
                  </div>
                  <Progress value={total ? (done / total) * 100 : 0} />
                </div>
              ) : null}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat label="Recipients" value={total} />
                <Stat label="Sent" value={s.sent ?? 0} />
                <Stat label="Delivered" value={s.delivered ?? 0} sub={pct(s.delivered, s.sent)} />
                <Stat label="Opened" value={s.opened ?? 0} sub={pct(s.opened, s.delivered)} />
                <Stat label="Clicked" value={s.clicked ?? 0} sub={pct(s.clicked, s.delivered)} />
                <Stat label="Unsubscribed" value={s.unsubscribed ?? 0} sub={pct(s.unsubscribed, s.delivered)} />
                <Stat label="Bounced" value={s.bounced ?? 0} sub={pct(s.bounced, s.sent)} />
                <Stat label="Complaints" value={s.complained ?? 0} sub={pct(s.complained, s.sent)} />
              </div>
              {(s.failed ?? 0) + (s.skipped ?? 0) + (s.ambiguous ?? 0) > 0 ? (
                <p className="text-muted-foreground text-xs">
                  Not sent: {s.failed ?? 0} failed · {s.skipped ?? 0} skipped (unsubscribed or suppressed before sending) ·{' '}
                  {s.ambiguous ?? 0} unconfirmed (interrupted; never retried automatically).
                </p>
              ) : null}
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">Recipients</CardTitle>
          <NativeSelect
            aria-label="Filter by status"
            className="w-44"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as SendStatus | 'all')
              setPage(0)
            }}
          >
            <option value="all">All statuses</option>
            {SEND_STATUSES.map((st) => (
              <option key={st} value={st}>
                {SEND_STATUS[st].label}
              </option>
            ))}
          </NativeSelect>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Sent</TableHead>
                  <TableHead>Activity</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(sends.data?.rows ?? []).map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="max-w-[260px] truncate">{r.to_email}</TableCell>
                    <TableCell>
                      <SendStatusBadge status={r.status} />
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs whitespace-nowrap">
                      {r.sent_at ? formatInZone(r.sent_at, current.timezone) : '—'}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-xs">
                      {[r.opened_at && 'opened', r.clicked_at && 'clicked', r.unsubscribed_at && 'unsubscribed']
                        .filter(Boolean)
                        .join(' · ') ||
                        (r.last_error ? <span title={r.last_error}>{r.last_error.slice(0, 60)}</span> : '—')}
                    </TableCell>
                  </TableRow>
                ))}
                {sends.data && sends.data.rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-muted-foreground py-6 text-center">
                      No recipients{status !== 'all' ? ' with this status' : ''}.
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </div>
          {sends.data && sends.data.total > SENDS_PAGE_SIZE ? (
            <div className="flex items-center justify-end gap-2 text-sm">
              <span className="text-muted-foreground tabular-nums">
                {page * SENDS_PAGE_SIZE + 1}–{Math.min((page + 1) * SENDS_PAGE_SIZE, sends.data.total)} of {sends.data.total}
              </span>
              <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                Previous
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={(page + 1) * SENDS_PAGE_SIZE >= sends.data.total}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}
