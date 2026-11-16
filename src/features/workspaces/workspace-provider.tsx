import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { FullScreenLoader } from '@/components/feedback/full-screen-loader'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { useUser } from '@/features/auth/auth-context'
import { getSupabase } from '@/lib/supabase/client'
import { useMyWorkspaces } from './api'
import { WorkspaceContext, type WorkspaceState } from './workspace-context'

const storageKey = (userId: string) => `mailpilot:workspace:${userId}`

function readStoredId(userId: string): string | null {
  try {
    return window.localStorage.getItem(storageKey(userId))
  } catch {
    return null
  }
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const user = useUser()
  const { data: workspaces, isPending, error, refetch } = useMyWorkspaces(user.id)
  const [selectedId, setSelectedId] = useState<string | null>(() => readStoredId(user.id))

  const selectWorkspace = useCallback(
    (id: string) => {
      setSelectedId(id)
      try {
        window.localStorage.setItem(storageKey(user.id), id)
      } catch {
        /* storage unavailable: selection lasts for this session only */
      }
    },
    [user.id],
  )

  const value = useMemo<WorkspaceState | null>(() => {
    if (!workspaces || workspaces.length === 0) return null
    const current = workspaces.find((w) => w.id === selectedId) ?? workspaces[0]!
    return { workspaces, current, selectWorkspace }
  }, [workspaces, selectedId, selectWorkspace])

  if (isPending) return <FullScreenLoader label="Loading workspace…" />

  if (error || !value) {
    return (
      <main className="flex min-h-svh items-center justify-center p-4">
        <Alert className="max-w-md" variant={error ? 'destructive' : 'default'}>
          <AlertTitle>{error ? 'Could not load your workspace' : 'No workspace found'}</AlertTitle>
          <AlertDescription className="space-y-3">
            <p>
              {error
                ? 'Check your connection and try again.'
                : 'Your account is not a member of any workspace. Contact the workspace owner for an invitation.'}
            </p>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => void refetch()}>
                Retry
              </Button>
              <Button size="sm" variant="ghost" onClick={() => void getSupabase().auth.signOut()}>
                Sign out
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      </main>
    )
  }

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
}
