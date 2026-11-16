import { LoaderCircle } from 'lucide-react'
import { PagePlaceholder } from '@/components/layout/page-placeholder'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { findNavItem } from '@/lib/constants/navigation'
import { useBackendHealth } from './use-backend-health'

function BackendStatusCard() {
  const { data, isPending, refetch, isFetching } = useBackendHealth()

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Backend connection
          {isPending ? (
            <LoaderCircle className="size-4 animate-spin text-muted-foreground" aria-label="Checking" />
          ) : data?.ok ? (
            <Badge>Connected</Badge>
          ) : (
            <Badge variant="destructive">Unreachable</Badge>
          )}
        </CardTitle>
        <CardDescription>Supabase Auth health check using the public client configuration.</CardDescription>
      </CardHeader>
      <CardContent className="flex items-center justify-between gap-4 text-sm">
        <span className="text-muted-foreground">
          {isPending
            ? 'Checking…'
            : data?.ok
              ? `Responded in ${data.latencyMs} ms`
              : `Error: ${data?.error ?? 'unknown'} — is \`supabase start\` running?`}
        </span>
        <button
          type="button"
          onClick={() => void refetch()}
          disabled={isFetching}
          className="text-sm font-medium underline-offset-4 hover:underline disabled:opacity-50"
        >
          Recheck
        </button>
      </CardContent>
    </Card>
  )
}

export default function DashboardPage() {
  return (
    <PagePlaceholder
      title="Dashboard"
      description={findNavItem('/')?.description ?? ''}
      phase="Phase 4"
      planned={[
        'Emails sent today / this month vs. workspace limits',
        'Recent campaigns with delivery and engagement summary',
        'Warnings: unverified sender domain, high bounce or complaint rate, paused sending',
      ]}
    >
      <BackendStatusCard />
    </PagePlaceholder>
  )
}
