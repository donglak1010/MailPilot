import { Check, ChevronsUpDown, LogOut, Settings } from 'lucide-react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useUser } from '@/features/auth/auth-context'
import { useWorkspace } from '@/features/workspaces/workspace-context'
import { getSupabase } from '@/lib/supabase/client'

function initials(source: string): string {
  const parts = source.trim().split(/\s+/)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?'
}

export function WorkspaceSwitcher() {
  const { workspaces, current, selectWorkspace } = useWorkspace()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="max-w-56 gap-2" aria-label="Switch workspace">
          <span className="truncate">{current.name}</span>
          <ChevronsUpDown className="size-3.5 opacity-60" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
        <DropdownMenuGroup>
          {workspaces.map((w) => (
            <DropdownMenuItem key={w.id} onSelect={() => selectWorkspace(w.id)}>
              <span className="flex-1 truncate">{w.name}</span>
              <Badge variant="outline" className="capitalize">
                {w.role}
              </Badge>
              {w.id === current.id ? <Check className="size-4" aria-label="Current" /> : null}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function UserMenu() {
  const user = useUser()
  const navigate = useNavigate()
  const name = (user.user_metadata?.full_name as string | undefined) ?? user.email ?? 'Account'

  async function signOut() {
    const { error } = await getSupabase().auth.signOut()
    if (error) toast.error('Could not sign out. Please try again.')
    else navigate('/login', { replace: true })
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="rounded-full" aria-label="Account menu">
          <Avatar className="size-8">
            <AvatarFallback>{initials(name)}</AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="font-normal">
          <div className="truncate text-sm font-medium">{name}</div>
          <div className="truncate text-xs text-muted-foreground">{user.email}</div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => navigate('/settings')}>
          <Settings aria-hidden /> Settings
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void signOut()}>
          <LogOut aria-hidden /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
