import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Copy, MoreHorizontal, RefreshCw, Send, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useWorkspace } from '@/features/workspaces/workspace-context'
import { isDomainVerified, PURPOSE_LABELS, refreshDomain, senderDomainKeys, type DnsRecord, type SenderDomain } from '../api'
import { DomainStatusBadge, StatusIcon } from './status'

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.success('Copied')
  } catch {
    toast.error('Could not copy — select the text and copy it manually')
  }
}

function CopyCell({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex min-w-0 items-start gap-1">
      <code className="min-w-0 break-all text-xs">{value}</code>
      <Button variant="ghost" size="icon-xs" className="shrink-0" onClick={() => copy(value)} aria-label={`Copy ${label}`}>
        <Copy />
      </Button>
    </div>
  )
}

function overallStatus(d: SenderDomain) {
  if (isDomainVerified(d)) return 'verified' as const
  if (d.verification_status === 'failed' || d.dkim_status === 'failed') return 'failed' as const
  if (d.verification_status === 'temporary_failure' || d.dkim_status === 'temporary_failure') return 'temporary_failure' as const
  return 'pending' as const
}

function formatChecked(ts: string | null) {
  if (!ts) return 'never'
  return new Date(ts).toLocaleString()
}

export function DomainCard({
  domain,
  canManage,
  onSendTest,
  onDelete,
}: {
  domain: SenderDomain
  canManage: boolean
  onSendTest: (d: SenderDomain) => void
  onDelete: (d: SenderDomain) => void
}) {
  const { current } = useWorkspace()
  const queryClient = useQueryClient()
  const verified = isDomainVerified(domain)
  const status = overallStatus(domain)
  const mailFrom = domain.dns_records.find((r) => r.purpose === 'mail_from_mx')

  const refresh = useMutation({
    mutationFn: () => refreshDomain(current.id, domain.id),
    onSuccess: async (d) => {
      await queryClient.invalidateQueries({ queryKey: senderDomainKeys.list(current.id) })
      toast[isDomainVerified(d) ? 'success' : 'info'](
        isDomainVerified(d) ? `${d.domain} is verified` : 'Not verified yet — DNS changes can take a while to propagate',
      )
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Could not check the domain'),
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <span className="break-all">{domain.domain}</span>
          <DomainStatusBadge status={status} />
        </CardTitle>
        <CardDescription>
          Region {domain.aws_region} · last checked {formatChecked(domain.last_checked_at)}
        </CardDescription>
        {canManage ? (
          <CardAction>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${domain.domain}`}>
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem variant="destructive" onSelect={() => onDelete(domain)}>
                  <Trash2 /> Remove domain
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </CardAction>
        ) : null}
      </CardHeader>

      <CardContent className="space-y-4">
        <ul className="grid gap-2 text-sm sm:grid-cols-3">
          <li className="flex items-center gap-2">
            <StatusIcon status={domain.verification_status} /> Domain verification
          </li>
          <li className="flex items-center gap-2">
            <StatusIcon status={domain.dkim_status} /> DKIM
          </li>
          <li className="flex items-center gap-2">
            <StatusIcon status={mailFrom?.status ?? 'pending'} /> Custom MAIL FROM
          </li>
        </ul>

        {!verified ? (
          <p className="text-muted-foreground text-sm">
            Add these records at your DNS provider, then press <strong>Check status</strong>. Propagation usually takes
            minutes but can take up to 72 hours.
          </p>
        ) : null}

        <DnsTable records={domain.dns_records} />

        <div className="text-muted-foreground space-y-1 text-xs">
          <p>
            • Some DNS providers (e.g. Netlify DNS, Cloudflare) add your root domain automatically: if the Name field
            already ends with your root domain, enter only the part before it.
          </p>
          <p>
            • A hostname may have only <strong>one</strong> SPF record. The SPF record above goes on{' '}
            <code>{mailFrom?.name ?? `bounce.${domain.domain}`}</code> — do not change the SPF record of your root domain.
          </p>
          <p>• If a DMARC record already exists for this name, keep the existing one instead of adding a second.</p>
        </div>
      </CardContent>

      <CardFooter className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={() => refresh.mutate()} disabled={refresh.isPending}>
          <RefreshCw className={refresh.isPending ? 'animate-spin' : undefined} />
          {refresh.isPending ? 'Checking…' : 'Check status'}
        </Button>
        {canManage ? (
          <Button size="sm" onClick={() => onSendTest(domain)} disabled={!verified} title={verified ? undefined : 'Verify the domain first'}>
            <Send /> Send test email
          </Button>
        ) : null}
      </CardFooter>
    </Card>
  )
}

function DnsTable({ records }: { records: DnsRecord[] }) {
  if (records.length === 0) {
    return <p className="text-muted-foreground text-sm">No DNS records yet — press Check status.</p>
  }
  return (
    <div className="overflow-x-auto rounded-md border">
      <Table className="table-fixed min-w-[640px]">
        <TableHeader>
          <TableRow>
            <TableHead className="w-16">Type</TableHead>
            <TableHead className="w-[38%]">Name / Host</TableHead>
            <TableHead>Value</TableHead>
            <TableHead className="w-28">Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {records.map((r) => (
            <TableRow key={`${r.type}-${r.name}-${r.value}`} className="align-top">
              <TableCell className="font-medium">
                {r.type}
                <div className="text-muted-foreground mt-1 text-[11px] font-normal whitespace-normal">{PURPOSE_LABELS[r.purpose]}</div>
              </TableCell>
              <TableCell className="whitespace-normal">
                <CopyCell value={r.name} label={`${r.type} name`} />
              </TableCell>
              <TableCell className="whitespace-normal">
                <CopyCell value={r.value} label={`${r.type} value`} />
                {r.priority !== undefined ? <div className="text-muted-foreground mt-1 text-xs">Priority {r.priority}</div> : null}
                {!r.required ? <div className="text-muted-foreground mt-1 text-xs">Optional</div> : null}
              </TableCell>
              <TableCell>
                <DomainStatusBadge status={r.status} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
