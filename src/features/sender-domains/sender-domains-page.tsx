import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Globe, Plus, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/feedback/confirm-dialog'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { canManageWorkspace, useWorkspace } from '@/features/workspaces/workspace-context'
import { findNavItem } from '@/lib/constants/navigation'
import { deleteDomain, senderDomainKeys, useSenderDomains, useSesAccount, type SenderDomain } from './api'
import { DomainCard } from './components/domain-card'
import { AddDomainDialog, SendTestDialog } from './components/domain-dialogs'

function SesAccountNotice() {
  const { current } = useWorkspace()
  const account = useSesAccount(current.id)
  if (account.isPending) return null
  if (account.isError) {
    return (
      <Alert variant="destructive">
        <TriangleAlert />
        <AlertTitle>Could not reach the sending service</AlertTitle>
        <AlertDescription>{account.error.message}</AlertDescription>
      </Alert>
    )
  }
  const a = account.data
  if (!a.configured) {
    return (
      <Alert>
        <TriangleAlert />
        <AlertTitle>Amazon SES is not connected yet</AlertTitle>
        <AlertDescription>
          The administrator must add the AWS secrets to the Edge Functions before domains can be added or verified.
        </AlertDescription>
      </Alert>
    )
  }
  if (a.mock) {
    return (
      <Alert>
        <TriangleAlert />
        <AlertTitle>SES mock mode (local development)</AlertTitle>
        <AlertDescription>
          No requests go to AWS: DKIM tokens are fake, domains verify on the first check and test emails are not delivered.
        </AlertDescription>
      </Alert>
    )
  }
  if (!a.production_access) {
    return (
      <Alert>
        <TriangleAlert />
        <AlertTitle>SES sandbox ({a.region})</AlertTitle>
        <AlertDescription>
          Email can only be sent to addresses verified in Amazon SES, up to {a.max_24h_send ?? 200} per 24 hours (
          {a.sent_last_24h ?? 0} used). Request production access in the AWS console before sending to real contacts.
        </AlertDescription>
      </Alert>
    )
  }
  if (!a.sending_enabled || (a.enforcement_status && a.enforcement_status !== 'HEALTHY')) {
    return (
      <Alert variant="destructive">
        <TriangleAlert />
        <AlertTitle>Sending is restricted by Amazon SES</AlertTitle>
        <AlertDescription>Account status: {a.enforcement_status ?? 'sending disabled'}. Check the SES console.</AlertDescription>
      </Alert>
    )
  }
  return null
}

export default function SenderDomainsPage() {
  const { current } = useWorkspace()
  const queryClient = useQueryClient()
  const canManage = canManageWorkspace(current.role)
  const domains = useSenderDomains(current.id)
  const [adding, setAdding] = useState(false)
  const [testing, setTesting] = useState<SenderDomain | null>(null)
  const [removing, setRemoving] = useState<SenderDomain | null>(null)

  const remove = useMutation({
    mutationFn: (d: SenderDomain) => deleteDomain(current.id, d.id),
    onSuccess: async (_r, d) => {
      await queryClient.invalidateQueries({ queryKey: senderDomainKeys.list(current.id) })
      toast.success(`${d.domain} removed`)
      setRemoving(null)
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Could not remove the domain'),
  })

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Sender Domains</h1>
          <p className="text-muted-foreground text-sm">{findNavItem('/sender-domains')?.description}</p>
        </div>
        {canManage ? (
          <Button onClick={() => setAdding(true)}>
            <Plus /> Add domain
          </Button>
        ) : null}
      </div>

      <SesAccountNotice />

      {domains.isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : domains.isError ? (
        <Alert variant="destructive">
          <AlertTitle>Could not load sender domains</AlertTitle>
          <AlertDescription>{domains.error.message}</AlertDescription>
        </Alert>
      ) : domains.data.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <Globe className="text-muted-foreground size-10" />
            <div>
              <p className="font-medium">No sending domain yet</p>
              <p className="text-muted-foreground max-w-md text-sm">
                Campaigns can only be sent from a verified domain. Add a subdomain such as <code>mail.yourbrand.com</code>{' '}
                and publish the DNS records we generate.
              </p>
            </div>
            {canManage ? (
              <Button onClick={() => setAdding(true)}>
                <Plus /> Add domain
              </Button>
            ) : null}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {domains.data.map((d) => (
            <DomainCard key={d.id} domain={d} canManage={canManage} onSendTest={setTesting} onDelete={setRemoving} />
          ))}
        </div>
      )}

      <AddDomainDialog open={adding} onOpenChange={setAdding} />
      <SendTestDialog domain={testing} onOpenChange={(o) => !o && setTesting(null)} />
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={`Remove ${removing?.domain ?? 'domain'}?`}
        description="The identity is deleted from Amazon SES and emails can no longer be sent from this domain. You can add it again later, but you will need to publish new DKIM records."
        confirmLabel="Remove"
        destructive
        pending={remove.isPending}
        onConfirm={() => removing && remove.mutate(removing)}
      />
    </div>
  )
}
