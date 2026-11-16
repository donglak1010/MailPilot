import { CircleCheck, CircleX } from 'lucide-react'
import { Link } from 'react-router'

export type ChecklistItem = { ok: boolean; label: string; fix?: { to: string; label: string } }

export function SendChecklist({ items }: { items: ChecklistItem[] }) {
  return (
    <ul className="space-y-1.5 text-sm">
      {items.map((item) => (
        <li key={item.label} className="flex items-start gap-2">
          {item.ok ? (
            <CircleCheck className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-label="Done" />
          ) : (
            <CircleX className="text-destructive mt-0.5 size-4 shrink-0" aria-label="Missing" />
          )}
          <span className={item.ok ? 'text-muted-foreground' : undefined}>
            {item.label}
            {!item.ok && item.fix ? (
              <>
                {' '}
                <Link to={item.fix.to} className="underline underline-offset-2">
                  {item.fix.label}
                </Link>
              </>
            ) : null}
          </span>
        </li>
      ))}
    </ul>
  )
}
