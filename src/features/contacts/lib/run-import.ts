import { getSupabase } from '@/lib/supabase/client'
import { chunk, IMPORT_LIMITS, type ColumnMapping, type ImportRow } from './csv-mapping'

export type ImportProgress = { processed: number; total: number; inserted: number; updated: number; skipped: number }

export type RunImportOptions = {
  workspaceId: string
  file: File
  rows: ImportRow[]
  mapping: ColumnMapping
  listId: string | null
  consentSource: string | null
  onProgress: (p: ImportProgress) => void
}

/**
 * Uploads the original file (audit trail), opens an import, sends rows in
 * bounded batches and closes it. Returns the import id and final counters.
 */
export async function runImport(opts: RunImportOptions): Promise<{ importId: string } & ImportProgress> {
  const supabase = getSupabase()
  const safeName = opts.file.name.replace(/[^\w.-]+/g, '_').slice(-80)
  const path = `${opts.workspaceId}/${crypto.randomUUID()}-${safeName}`

  const upload = await supabase.storage
    .from('contact-imports')
    .upload(path, opts.file, { contentType: 'text/csv', upsert: false })
  if (upload.error) throw upload.error

  const { data: importId, error: startError } = await supabase.rpc('start_contact_import', {
    p_workspace_id: opts.workspaceId,
    p_storage_path: path,
    p_total_rows: opts.rows.length,
    p_column_mapping: opts.mapping,
    p_list_id: opts.listId ?? undefined,
    p_consent_source: opts.consentSource ?? undefined,
  })
  if (startError) throw startError

  const progress: ImportProgress = { processed: 0, total: opts.rows.length, inserted: 0, updated: 0, skipped: 0 }
  opts.onProgress({ ...progress })

  try {
    for (const batch of chunk(opts.rows, IMPORT_LIMITS.batchSize)) {
      const { data, error } = await supabase.rpc('import_contacts_batch', { p_import_id: importId, p_rows: batch })
      if (error) throw error
      const r = data as { inserted: number; updated: number; skipped: number }
      progress.processed += batch.length
      progress.inserted += r.inserted
      progress.updated += r.updated
      progress.skipped += r.skipped
      opts.onProgress({ ...progress })
    }
    const { error: finishError } = await supabase.rpc('finish_contact_import', { p_import_id: importId })
    if (finishError) throw finishError
  } catch (err) {
    const message = err instanceof Error ? err.message : 'import_failed'
    await supabase.rpc('finish_contact_import', { p_import_id: importId, p_error: message })
    throw err
  }

  return { importId, ...progress }
}
