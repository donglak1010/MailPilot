import { useMutation } from '@tanstack/react-query'
import { CircleCheck, MailX } from 'lucide-react'
import { useSearchParams } from 'react-router'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { invokeFunction } from '@/lib/supabase/functions'

/**
 * Public page linked from every email ({{unsubscribe_url}}). No sign-in.
 * Opening it never unsubscribes (link scanners prefetch URLs); the button does.
 */
export default function UnsubscribePage() {
  const [params] = useSearchParams()
  const token = params.get('t') ?? ''
  const isPreview = token === 'preview'

  const mutation = useMutation({
    mutationFn: () => invokeFunction<{ unsubscribed: true; sender: string | null }>('unsubscribe', { token }),
  })

  return (
    <div className="bg-muted/30 flex min-h-svh items-center justify-center p-4">
      <Card className="w-full max-w-md">
        {mutation.isSuccess ? (
          <>
            <CardHeader className="items-center text-center">
              <CircleCheck className="mb-2 size-10 text-emerald-600 dark:text-emerald-400" />
              <CardTitle>You are unsubscribed</CardTitle>
              <CardDescription>
                {mutation.data.sender ? `${mutation.data.sender} will` : 'The sender will'} no longer send you marketing emails at
                this address.
              </CardDescription>
            </CardHeader>
          </>
        ) : (
          <>
            <CardHeader className="items-center text-center">
              <MailX className="text-muted-foreground mb-2 size-10" />
              <CardTitle>Unsubscribe</CardTitle>
              <CardDescription>Stop receiving marketing emails from this sender.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {isPreview ? (
                <Alert>
                  <AlertDescription>This link comes from a test email — nothing will change.</AlertDescription>
                </Alert>
              ) : !token ? (
                <Alert variant="destructive">
                  <AlertDescription>This unsubscribe link is incomplete. Open it again from the email.</AlertDescription>
                </Alert>
              ) : null}
              {mutation.isError ? (
                <Alert variant="destructive">
                  <AlertDescription>{mutation.error.message}</AlertDescription>
                </Alert>
              ) : null}
            </CardContent>
            <CardFooter>
              <Button className="w-full" disabled={!token || isPreview || mutation.isPending} onClick={() => mutation.mutate()}>
                {mutation.isPending ? 'Unsubscribing…' : 'Unsubscribe'}
              </Button>
            </CardFooter>
          </>
        )}
      </Card>
    </div>
  )
}
