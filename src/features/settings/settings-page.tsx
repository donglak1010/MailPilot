import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useUser } from '@/features/auth/auth-context'
import { useWorkspaceMembers, useWorkspaceUsage } from '@/features/workspaces/api'
import { useWorkspace } from '@/features/workspaces/workspace-context'
import { WorkspaceSettingsForm } from './workspace-settings-form'

const fmt = new Intl.NumberFormat()

function UsageRow({ label, used, limit }: { label: string; used: number; limit: number }) {
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 100
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-sm">
        <span>{label}</span>
        <span className="tabular-nums text-muted-foreground">
          {fmt.format(used)} / {fmt.format(limit)}
        </span>
      </div>
      <div
        className="h-2 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={limit}
        aria-valuenow={used}
      >
        <div className={`h-full ${pct >= 90 ? 'bg-destructive' : 'bg-primary'}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

function LimitsCard() {
  const { current } = useWorkspace()
  const usage = useWorkspaceUsage(current.id)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Sending limits
          <Badge variant={current.sending_status === 'active' ? 'secondary' : 'destructive'} className="capitalize">
            {current.sending_status}
          </Badge>
        </CardTitle>
        <CardDescription>Limits protect the shared sending reputation. Contact support to raise them.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {usage.isPending ? (
          <Skeleton className="h-24" />
        ) : (
          <>
            <UsageRow label="Emails today" used={usage.data?.sentToday ?? 0} limit={current.daily_send_limit} />
            <UsageRow label="Emails this month" used={usage.data?.sentThisMonth ?? 0} limit={current.monthly_send_limit} />
            <UsageRow label="AI generations this month" used={usage.data?.aiThisMonth ?? 0} limit={current.monthly_ai_limit} />
            <p className="text-sm text-muted-foreground">Max contacts: {fmt.format(current.max_contacts)}</p>
          </>
        )}
      </CardContent>
    </Card>
  )
}

function MembersCard() {
  const { current } = useWorkspace()
  const user = useUser()
  const members = useWorkspaceMembers(current.id)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Members</CardTitle>
        <CardDescription>Inviting teammates comes after the internal pilot.</CardDescription>
      </CardHeader>
      <CardContent>
        {members.isPending ? (
          <Skeleton className="h-10" />
        ) : members.error ? (
          <p className="text-sm text-destructive">Could not load members.</p>
        ) : (
          <ul className="divide-y">
            {members.data.map((m) => (
              <li key={m.userId} className="flex items-center justify-between py-2 text-sm">
                <span>
                  {m.fullName ?? 'Unnamed member'}
                  {m.userId === user.id ? <span className="text-muted-foreground"> (you)</span> : null}
                </span>
                <Badge variant="outline" className="capitalize">
                  {m.role}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

export default function SettingsPage() {
  return (
    <section className="space-y-6" aria-labelledby="page-title">
      <div className="space-y-1">
        <h2 id="page-title" className="text-2xl font-semibold tracking-tight">
          Settings
        </h2>
        <p className="text-sm text-muted-foreground">Workspace, timezone, sender defaults and usage.</p>
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <WorkspaceSettingsForm />
        <div className="space-y-6">
          <LimitsCard />
          <MembersCard />
        </div>
      </div>
    </section>
  )
}
