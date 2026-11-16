import type { ReactNode } from 'react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

type PagePlaceholderProps = {
  title: string
  description: string
  phase: string
  planned: string[]
  children?: ReactNode
}

/** Temporary page body used until each feature module is implemented. */
export function PagePlaceholder({ title, description, phase, planned, children }: PagePlaceholderProps) {
  return (
    <section className="space-y-6" aria-labelledby="page-title">
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id="page-title" className="text-2xl font-semibold tracking-tight">
            {title}
          </h2>
          <Badge variant="secondary">{phase}</Badge>
        </div>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>

      {children}

      <Card>
        <CardHeader>
          <CardTitle>Planned for this module</CardTitle>
          <CardDescription>Not built yet — this page is a placeholder.</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {planned.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </section>
  )
}
