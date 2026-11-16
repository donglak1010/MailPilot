import { useLocation } from 'react-router'
import { Separator } from '@/components/ui/separator'
import { SidebarTrigger } from '@/components/ui/sidebar'
import { findNavItem } from '@/lib/constants/navigation'

export function TopBar() {
  const { pathname } = useLocation()
  const current = findNavItem(pathname)

  return (
    <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <SidebarTrigger className="-ml-1" aria-label="Toggle sidebar" />
      <Separator orientation="vertical" className="mr-2 data-[orientation=vertical]:h-4" />
      <h1 className="text-sm font-medium">{current?.title ?? 'MailPilot'}</h1>
      <div className="ml-auto flex items-center gap-2">
        {/* Workspace switcher and user menu arrive in Phase 1 (auth). */}
      </div>
    </header>
  )
}
