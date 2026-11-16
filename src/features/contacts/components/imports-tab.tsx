import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useWorkspace } from '@/features/workspaces/workspace-context'
import { useState } from 'react'
import { useImports, type CsvImport } from '../api'
import { SkippedList, type SkippedRow } from './import-wizard'

const dtFmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })

const STATUS_VARIANT = {
  uploaded: 'outline',
  processing: 'secondary',
  completed: 'default',
  failed: 'destructive',
} as const

export function ImportsTab() {
  const { current } = useWorkspace()
  const imports = useImports(current.id)
  const [viewing, setViewing] = useState<CsvImport | null>(null)

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">The last 50 CSV imports. Original files are kept privately for your records.</p>
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Started</TableHead>
              <TableHead>File</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Rows</TableHead>
              <TableHead className="text-right">New</TableHead>
              <TableHead className="text-right">Updated</TableHead>
              <TableHead className="text-right">Skipped</TableHead>
              <TableHead>Consent</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {imports.isPending ? (
              <TableRow>
                <TableCell colSpan={8}>
                  <Skeleton className="h-5" />
                </TableCell>
              </TableRow>
            ) : imports.data?.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="py-10 text-center text-muted-foreground">
                  No imports yet.
                </TableCell>
              </TableRow>
            ) : (
              imports.data?.map((i) => (
                <TableRow key={i.id}>
                  <TableCell className="whitespace-nowrap">{dtFmt.format(new Date(i.created_at))}</TableCell>
                  <TableCell className="max-w-48 truncate">{i.storage_path.split('/').pop()?.replace(/^[0-9a-f-]{36}-/, '')}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[i.status]} className="capitalize">
                      {i.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{i.total_rows.toLocaleString()}</TableCell>
                  <TableCell className="text-right tabular-nums">{i.inserted_rows.toLocaleString()}</TableCell>
                  <TableCell className="text-right tabular-nums">{i.updated_rows.toLocaleString()}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {i.skipped_rows > 0 ? (
                      <Button variant="link" size="sm" className="h-auto p-0" onClick={() => setViewing(i)}>
                        {i.skipped_rows.toLocaleString()}
                      </Button>
                    ) : (
                      0
                    )}
                  </TableCell>
                  <TableCell className="max-w-56 truncate text-muted-foreground" title={i.consent_source ?? ''}>
                    {i.consent_source ?? 'None — imported as pending'}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      <Dialog open={viewing !== null} onOpenChange={(o) => !o && setViewing(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Skipped rows</DialogTitle>
          </DialogHeader>
          {viewing ? <SkippedList errors={viewing.errors as SkippedRow[]} /> : null}
          <p className="text-xs text-muted-foreground">Up to 200 skipped rows are recorded per import.</p>
        </DialogContent>
      </Dialog>
    </div>
  )
}
