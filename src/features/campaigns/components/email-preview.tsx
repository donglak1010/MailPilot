import { renderEmail } from '@shared/render'
import { Monitor, Smartphone } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { cn } from '@/lib/utils'

type PreviewInput = {
  subject: string
  preview_text: string
  html_body: string
  text_body: string
  from_name: string | null
  from_email: string | null
}

const SAMPLE_CONTACT = { first_name: 'Alex', last_name: 'Nguyen', email: 'alex@example.com', custom_fields: {} }

/** Live preview rendered with the same code the send worker uses (sample contact). */
export function EmailPreview({ draft, postalAddress }: { draft: PreviewInput; postalAddress: string | null }) {
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop')
  const [mode, setMode] = useState<'html' | 'text'>('html')
  const debounced = useDebouncedValue(draft, 300)

  const email = useMemo(
    () =>
      renderEmail({
        subject: debounced.subject,
        preview_text: debounced.preview_text,
        html_body: debounced.html_body,
        text_body: debounced.text_body,
        postal_address: postalAddress,
        contact: SAMPLE_CONTACT,
        unsubscribe_url: '#unsubscribe-preview',
      }),
    [debounced, postalAddress],
  )

  return (
    <Card className="gap-3">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle className="text-base">Preview</CardTitle>
        <div className="flex gap-1">
          <Button size="xs" variant={mode === 'html' ? 'secondary' : 'ghost'} onClick={() => setMode('html')}>
            HTML
          </Button>
          <Button size="xs" variant={mode === 'text' ? 'secondary' : 'ghost'} onClick={() => setMode('text')}>
            Text
          </Button>
          <Button
            size="icon-xs"
            variant={device === 'desktop' ? 'secondary' : 'ghost'}
            onClick={() => setDevice('desktop')}
            aria-label="Desktop width"
          >
            <Monitor />
          </Button>
          <Button
            size="icon-xs"
            variant={device === 'mobile' ? 'secondary' : 'ghost'}
            onClick={() => setDevice('mobile')}
            aria-label="Mobile width"
          >
            <Smartphone />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="bg-muted/50 space-y-0.5 rounded-md p-3 text-sm">
          <div className="truncate">
            <span className="text-muted-foreground">From: </span>
            {draft.from_name ? `${draft.from_name} ` : ''}
            {draft.from_email ? `<${draft.from_email}>` : <em className="text-muted-foreground">not set</em>}
          </div>
          <div className="truncate font-medium">{email.subject || <em className="text-muted-foreground">No subject</em>}</div>
          {draft.preview_text ? <div className="text-muted-foreground truncate text-xs">{draft.preview_text}</div> : null}
        </div>
        {mode === 'html' ? (
          <div className="bg-muted/30 flex justify-center overflow-hidden rounded-md border">
            <iframe
              title="Email preview"
              sandbox=""
              srcDoc={email.html}
              className={cn('h-[560px] bg-white transition-[width]', device === 'mobile' ? 'w-[375px]' : 'w-full')}
            />
          </div>
        ) : (
          <pre className="bg-muted/30 h-[560px] overflow-auto rounded-md border p-3 text-xs whitespace-pre-wrap">{email.text}</pre>
        )}
        <p className="text-muted-foreground text-xs">
          Merge tags are shown with a sample contact (Alex Nguyen). Links in the preview are disabled.
        </p>
      </CardContent>
    </Card>
  )
}
