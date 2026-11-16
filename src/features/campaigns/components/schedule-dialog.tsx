import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { fromZonedInput, toZonedInput } from '@/lib/timezone'

export function ScheduleDialog({
  open,
  onOpenChange,
  timeZone,
  initial,
  pending,
  onSchedule,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  timeZone: string
  initial: string | null
  pending: boolean
  onSchedule: (at: Date) => void
}) {
  const defaultValue = () => toZonedInput(initial ?? new Date(Date.now() + 60 * 60_000).toISOString(), timeZone)
  const [value, setValue] = useState(defaultValue)
  const [error, setError] = useState<string>()

  function submit() {
    const at = fromZonedInput(value, timeZone)
    if (!at) return setError('Pick a date and time.')
    if (at.getTime() < Date.now() + 2 * 60_000) return setError('Pick a time at least 2 minutes from now.')
    if (at.getTime() > Date.now() + 365 * 24 * 3600_000) return setError('Pick a time within the next year.')
    setError(undefined)
    onSchedule(at)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (o) setValue(defaultValue())
        setError(undefined)
        onOpenChange(o)
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Schedule campaign</DialogTitle>
          <DialogDescription>
            Time zone: <strong>{timeZone}</strong> (change it in Settings). The audience is resolved when sending starts.
          </DialogDescription>
        </DialogHeader>
        <Field data-invalid={error ? true : undefined} className="py-2">
          <FieldLabel htmlFor="schedule-at">Send at</FieldLabel>
          <Input id="schedule-at" type="datetime-local" value={value} onChange={(e) => setValue(e.target.value)} />
          {error ? <FieldError>{error}</FieldError> : <FieldDescription>Local time in {timeZone}.</FieldDescription>}
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending}>
            {pending ? 'Scheduling…' : 'Schedule'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
