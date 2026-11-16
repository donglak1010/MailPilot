import { createContext, useContext } from 'react'
import type { WorkspaceRole, WorkspaceWithRole } from '@/types/app'

export type WorkspaceState = {
  workspaces: WorkspaceWithRole[]
  current: WorkspaceWithRole
  selectWorkspace: (id: string) => void
}

export const WorkspaceContext = createContext<WorkspaceState | undefined>(undefined)

export function useWorkspace(): WorkspaceState {
  const ctx = useContext(WorkspaceContext)
  if (!ctx) throw new Error('useWorkspace must be used inside <WorkspaceProvider>')
  return ctx
}

const MANAGER_ROLES: readonly WorkspaceRole[] = ['owner', 'admin']

/** UI hint only — the database (RLS) is the real authority. */
export function canManageWorkspace(role: WorkspaceRole): boolean {
  return MANAGER_ROLES.includes(role)
}
