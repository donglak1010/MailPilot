import type { Database } from './database'

type PublicSchema = Database['public']

export type Tables<T extends keyof PublicSchema['Tables']> = PublicSchema['Tables'][T]['Row']
export type TablesUpdate<T extends keyof PublicSchema['Tables']> = PublicSchema['Tables'][T]['Update']
export type Enums<T extends keyof PublicSchema['Enums']> = PublicSchema['Enums'][T]

export type Workspace = Tables<'workspaces'>
export type WorkspaceRole = Enums<'workspace_role'>
export type WorkspaceWithRole = Workspace & { role: WorkspaceRole }
