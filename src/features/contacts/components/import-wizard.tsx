import { useQuery, useQueryClient } from '@tanstack/react-query'
import { FileUp } from 'lucide-react'
import Papa from 'papaparse'
import { useMemo, useState, type ChangeEvent } from 'react'
import { toast } from 'sonner'
import { NativeSelect } from '@/components/form/native-select'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useWorkspace } from '@/features/workspaces/workspace-context'
import { getSupabase } from '@/lib/supabase/client'
import { dbErrorMessage } from '@/lib/supabase/errors'
import { contactKeys, useContactLists } from '../api'
import {
  buildRows,
  guessMapping,
  guessNameOrder,
  IMPORT_LIMITS,
  SKIP_REASON_LABELS,
  toCustomKey,
  validateMapping,
  type ColumnMapping,
  type ColumnTarget,
} from '../lib/csv-mapping'
import { runImport, type ImportProgress } from '../lib/run-import'

type Parsed = { file: File; headers: string[]; records: Record<string, string>[] }
type Step = 'file' | 'map' | 'running' | 'done'

const TARGET_OPTIONS: { value: string; label: string }[] = [
  { value: 'email', label: 'Email (required)' },
  { value: 'first_name', label: 'First name' },
  { value: 'last_name', label: 'Last name' },
  { value: 'full_name', label: 'Full name — First Last' },
  { value: 'full_name_vn', label: 'Họ tên — Họ Đệm Tên (VN)' },
  { value: 'custom', label: 'Custom field' },
  { value: 'ignore', label: 'Do not import' },
]

const PROBLEM_TEXT = {
  no_email: 'Choose which column contains the email address.',
  multiple_email: 'Only one column can be mapped to Email.',
  too_many_custom: `Map at most ${IMPORT_LIMITS.maxCustomFields} custom fields.`,
  duplicate_custom_key: 'Two columns map to the same custom field name.',
} as const

export function ImportWizard({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [busy, setBusy] = useState(false)
  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-3xl">
        {open ? <Wizard onClose={() => onOpenChange(false)} onBusyChange={setBusy} /> : null}
      </DialogContent>
    </Dialog>
  )
}

function Wizard({ onClose, onBusyChange }: { onClose: () => void; onBusyChange: (busy: boolean) => void }) {
  const { current } = useWorkspace()
  const queryClient = useQueryClient()
  const lists = useContactLists(current.id)

  const [step, setStep] = useState<Step>('file')
  const [fileError, setFileError] = useState<string | null>(null)
  const [parsed, setParsed] = useState<Parsed | null>(null)
  const [mapping, setMapping] = useState<ColumnMapping>({})
  const [listId, setListId] = useState('')
  const [hasConsent, setHasConsent] = useState(false)
  const [consentSource, setConsentSource] = useState('')
  const [progress, setProgress] = useState<ImportProgress | null>(null)
  const [runError, setRunError] = useState<string | null>(null)
  const [importId, setImportId] = useState<string | null>(null)

  const problems = useMemo(() => validateMapping(mapping), [mapping])
  const consentMissing = hasConsent && consentSource.trim().length < 5

  function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    setFileError(null)
    if (!file) return
    if (!/\.csv$/i.test(file.name)) return setFileError('Choose a .csv file. Export it from Excel/Google Sheets as CSV.')
    if (file.size > IMPORT_LIMITS.maxFileBytes) return setFileError('The file is larger than 10 MB. Split it into smaller files.')

    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: 'greedy',
      transformHeader: (h) => h.trim(),
      complete: (result) => {
        const headers = (result.meta.fields ?? []).filter(Boolean)
        if (headers.length === 0) return setFileError('No header row found. The first row must contain column names.')
        if (result.data.length === 0) return setFileError('The file has no data rows.')
        if (result.data.length > IMPORT_LIMITS.maxRows)
          return setFileError(`The file has ${result.data.length.toLocaleString()} rows; the limit is ${IMPORT_LIMITS.maxRows.toLocaleString()}.`)
        const guessed = guessMapping(headers)
        // Full-name columns: pick Vietnamese (family-first) or Western order from the data itself
        for (const [h, t] of Object.entries(guessed)) {
          if (t.kind === 'full_name') guessed[h] = { kind: guessNameOrder(result.data.map((r) => r[h])) }
        }
        setParsed({ file, headers, records: result.data })
        setMapping(guessed)
        setStep('map')
      },
      error: (err) => setFileError(`Could not read the file: ${err.message}`),
    })
  }

  function setTarget(header: string, value: string) {
    const target: ColumnTarget =
      value === 'custom' ? { kind: 'custom', key: toCustomKey(header) } : ({ kind: value } as ColumnTarget)
    setMapping((m) => ({ ...m, [header]: target }))
  }

  async function start() {
    if (!parsed) return
    setStep('running')
    onBusyChange(true)
    setRunError(null)
    try {
      const result = await runImport({
        workspaceId: current.id,
        file: parsed.file,
        rows: buildRows(parsed.records, mapping),
        mapping,
        listId: listId || null,
        consentSource: hasConsent ? consentSource.trim() : null,
        onProgress: setProgress,
      })
      setImportId(result.importId)
      toast.success(`Import finished: ${result.inserted} new, ${result.updated} updated`)
    } catch (err) {
      setRunError(dbErrorMessage(err, 'The import failed.'))
    } finally {
      onBusyChange(false)
      setStep('done')
      await queryClient.invalidateQueries({ queryKey: contactKeys.all(current.id) })
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Import contacts from CSV</DialogTitle>
        <DialogDescription>
          {step === 'file' && 'Step 1 of 3 — choose a CSV file with a header row.'}
          {step === 'map' && 'Step 2 of 3 — match columns and confirm consent.'}
          {step === 'running' && 'Step 3 of 3 — importing…'}
          {step === 'done' && 'Import summary'}
        </DialogDescription>
      </DialogHeader>

      {step === 'file' ? (
        <div className="space-y-4 py-4">
          <label className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed p-8 text-center hover:bg-muted/50 focus-within:ring-[3px] focus-within:ring-ring/50">
            <FileUp className="size-8 text-muted-foreground" aria-hidden />
            <span className="font-medium">Choose CSV file</span>
            <span className="text-sm text-muted-foreground">Up to 10 MB and {IMPORT_LIMITS.maxRows.toLocaleString()} rows</span>
            <input type="file" accept=".csv,text/csv" className="sr-only" onChange={onFile} />
          </label>
          {fileError ? (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{fileError}</AlertDescription>
            </Alert>
          ) : null}
          <Alert>
            <AlertTitle>Only import people who opted in</AlertTitle>
            <AlertDescription>
              Purchased, scraped or third-party lists are not allowed. Sending to them damages deliverability for every
              MailPilot user and may be illegal where your recipients live.
            </AlertDescription>
          </Alert>
        </div>
      ) : null}

      {step === 'map' && parsed ? (
        <div className="space-y-5 py-4">
          <p className="text-sm">
            <strong>{parsed.file.name}</strong> — {parsed.records.length.toLocaleString()} rows, {parsed.headers.length} columns
          </p>
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Column in file</TableHead>
                  <TableHead>Sample values</TableHead>
                  <TableHead className="w-56">Import as</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {parsed.headers.map((h) => {
                  const target = mapping[h] ?? { kind: 'ignore' }
                  return (
                    <TableRow key={h}>
                      <TableCell className="font-medium">{h}</TableCell>
                      <TableCell className="max-w-64 truncate text-muted-foreground">
                        {parsed.records
                          .slice(0, 3)
                          .map((r) => r[h])
                          .filter(Boolean)
                          .join(' · ') || '—'}
                      </TableCell>
                      <TableCell>
                        <NativeSelect aria-label={`Import ${h} as`} value={target.kind} onChange={(e) => setTarget(h, e.target.value)}>
                          {TARGET_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </NativeSelect>
                        {target.kind === 'custom' ? (
                          <p className="mt-1 font-mono text-xs text-muted-foreground">{`{{${target.key}}}`}</p>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>

          {problems.length > 0 ? (
            <Alert variant="destructive" role="alert">
              <AlertDescription>
                {problems.map((p) => (
                  <div key={p}>{PROBLEM_TEXT[p]}</div>
                ))}
              </AlertDescription>
            </Alert>
          ) : null}

          <Field>
            <FieldLabel htmlFor="import-list">Add imported contacts to list (optional)</FieldLabel>
            <NativeSelect id="import-list" value={listId} onChange={(e) => setListId(e.target.value)}>
              <option value="">No list</option>
              {lists.data?.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </NativeSelect>
            <FieldDescription>Sequences triggered by this list will start for subscribed contacts.</FieldDescription>
          </Field>

          <div className="space-y-3 rounded-md border p-4">
            <label className="flex items-start gap-3 text-sm">
              <Checkbox className="mt-0.5" checked={hasConsent} onCheckedChange={(c) => setHasConsent(c === true)} />
              <span>
                <span className="font-medium">These people gave me permission to send them marketing email.</span>
                <span className="block text-muted-foreground">
                  New contacts will be <strong>subscribed</strong>. Without this, they are imported as <strong>pending</strong> and
                  will not receive email.
                </span>
              </span>
            </label>
            {hasConsent ? (
              <Field data-invalid={consentMissing ? true : undefined}>
                <FieldLabel htmlFor="consent-source">How did they opt in?</FieldLabel>
                <Input
                  id="consent-source"
                  placeholder="e.g. Ebook download form on mysite.com, Jan–Oct 2026"
                  value={consentSource}
                  maxLength={500}
                  onChange={(e) => setConsentSource(e.target.value)}
                  aria-invalid={consentMissing ? true : undefined}
                />
                <FieldDescription>Stored on every imported contact as evidence of consent.</FieldDescription>
              </Field>
            ) : null}
            <p className="text-xs text-muted-foreground">
              Existing contacts keep their current status — importing never re-subscribes someone who unsubscribed, bounced or
              complained.
            </p>
          </div>
        </div>
      ) : null}

      {step === 'running' || step === 'done' ? (
        <div className="space-y-4 py-4">
          {progress ? (
            <>
              <Progress value={(progress.processed / Math.max(1, progress.total)) * 100} aria-label="Import progress" />
              <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                <Stat label="Processed" value={`${progress.processed.toLocaleString()} / ${progress.total.toLocaleString()}`} />
                <Stat label="New" value={progress.inserted} />
                <Stat label="Updated" value={progress.updated} />
                <Stat label="Skipped" value={progress.skipped} />
              </dl>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Uploading file…</p>
          )}
          {runError ? (
            <Alert variant="destructive" role="alert">
              <AlertTitle>Import stopped</AlertTitle>
              <AlertDescription>{runError} Rows processed before the error were saved.</AlertDescription>
            </Alert>
          ) : null}
          {step === 'done' && importId && progress && progress.skipped > 0 ? <SkippedRows importId={importId} /> : null}
        </div>
      ) : null}

      <DialogFooter>
        {step === 'map' ? (
          <>
            <Button variant="outline" onClick={() => setStep('file')}>
              Back
            </Button>
            <Button disabled={problems.length > 0 || consentMissing} onClick={() => void start()}>
              Import {parsed?.records.length.toLocaleString()} rows
            </Button>
          </>
        ) : step === 'running' ? (
          <Button disabled>Importing…</Button>
        ) : (
          <Button variant={step === 'done' ? 'default' : 'outline'} onClick={onClose}>
            {step === 'done' ? 'Done' : 'Cancel'}
          </Button>
        )}
      </DialogFooter>
    </>
  )
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md border p-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-lg font-semibold tabular-nums">{typeof value === 'number' ? value.toLocaleString() : value}</dd>
    </div>
  )
}

export type SkippedRow = { row?: number; email?: string; reason: string }

function SkippedRows({ importId }: { importId: string }) {
  const { data: errors } = useQuery({
    queryKey: ['csv-import-errors', importId],
    queryFn: async () => {
      const { data, error } = await getSupabase().from('csv_imports').select('errors').eq('id', importId).single()
      if (error) throw error
      return data.errors as SkippedRow[]
    },
  })
  if (!errors) return null
  return <SkippedList errors={errors} />
}

export function SkippedList({ errors }: { errors: SkippedRow[] }) {
  return (
    <div className="max-h-48 overflow-y-auto rounded-md border text-sm">
      <ul className="divide-y">
        {errors.slice(0, 50).map((e, i) => (
          <li key={i} className="flex justify-between gap-4 px-3 py-1.5">
            <span className="truncate">{e.email || '(empty)'}</span>
            <span className="text-muted-foreground">{SKIP_REASON_LABELS[e.reason] ?? e.reason}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
