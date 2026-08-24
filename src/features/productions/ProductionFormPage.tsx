import { useCallback, useEffect, useId, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Timestamp } from 'firebase/firestore'
import { ArrowLeft } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useOrganization } from '@/features/organizations/useOrganization'
import { PRODUCTION_STATUS_LABELS } from '@/domain/production'
import { createProduction, getProduction, updateProduction } from '@/services/production-service'
import { toDateKey } from '@/domain/calendar'
import { toOrganizationErrorMessage } from '@/services/organization-errors-view'
import { PRODUCTION_STATUSES, type Production, type ProductionStatus } from '@/types/production'
import { paths } from '@/routes/paths'

function toDate(value: string): Timestamp | null {
  return value ? Timestamp.fromDate(new Date(`${value}T00:00:00`)) : null
}

export function ProductionFormPage({ mode }: { mode: 'create' | 'edit' }) {
  const navigate = useNavigate()
  const { productionId } = useParams<{ productionId: string }>()
  const { organization } = useOrganization()
  const fieldId = useId()

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [notes, setNotes] = useState('')
  const [status, setStatus] = useState<ProductionStatus>('planning')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [existing, setExisting] = useState<Production | null>(null)
  const [loading, setLoading] = useState(mode === 'edit')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // State settles in the promise continuations rather than synchronously, so
  // the effect starts the read and nothing else.
  const load = useCallback((): Promise<void> => {
    if (mode !== 'edit' || !productionId) return Promise.resolve()
    const organizationId = organization?.organization_id

    return getProduction(productionId).then(
      (production) => {
        setLoading(false)

        if (!production || production.organization_id !== organizationId) {
          setError('That production was not found in this organization.')
          return
        }

        setExisting(production)
        setTitle(production.title)
        setDescription(production.description ?? '')
        setNotes(production.notes ?? '')
        setStatus(production.status)
        // Local parts, matching how `toTimestamp` reads the input back.
        setStartDate(production.start_date ? toDateKey(production.start_date.toDate()) : '')
        setEndDate(production.end_date ? toDateKey(production.end_date.toDate()) : '')
      },
      (caught: unknown) => { setLoading(false); setError(toOrganizationErrorMessage(caught)) },
    )
  }, [mode, productionId, organization])

  useEffect(() => {
    void load()
  }, [load])

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (submitting || !organization) return

    setError(null)
    const input = {
      title, description, notes, status,
      startDate: toDate(startDate), endDate: toDate(endDate),
    }

    setSubmitting(true)
    try {
      if (mode === 'edit' && existing) {
        await updateProduction({ existing, input })
        navigate(paths.production(existing.production_id), { replace: true })
      } else {
        const { productionId: created } = await createProduction({
          organizationId: organization.organization_id, input,
        })
        navigate(paths.production(created), { replace: true })
      }
    } catch (caught) {
      setError(toOrganizationErrorMessage(caught))
      setSubmitting(false)
    }
  }

  if (loading) return <p className="text-muted-foreground text-sm">Loading production…</p>

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link to={existing ? paths.production(existing.production_id) : paths.productions}>
          <ArrowLeft className="size-4" aria-hidden="true" />
          Cancel
        </Link>
      </Button>

      <h1 className="text-2xl font-semibold tracking-tight">
        {mode === 'edit' ? 'Edit production' : 'New production'}
      </h1>

      <form onSubmit={handleSubmit} className="space-y-6" noValidate>
        <Card>
          <CardHeader><CardTitle className="text-base">Production</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor={`${fieldId}-title`}>Title</Label>
              <Input id={`${fieldId}-title`} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} disabled={submitting} required autoFocus />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${fieldId}-status`}>Status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as ProductionStatus)} disabled={submitting}>
                <SelectTrigger id={`${fieldId}-status`}><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PRODUCTION_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>{PRODUCTION_STATUS_LABELS[s]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div />
            <div className="space-y-2">
              <Label htmlFor={`${fieldId}-start`}>Start date</Label>
              <Input id={`${fieldId}-start`} type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} disabled={submitting} />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${fieldId}-end`}>End date</Label>
              <Input id={`${fieldId}-end`} type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} disabled={submitting} />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor={`${fieldId}-description`}>Description</Label>
              <textarea id={`${fieldId}-description`} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} rows={3} disabled={submitting}
                className="border-input bg-transparent focus-visible:ring-ring w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none" />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor={`${fieldId}-notes`}>Notes</Label>
              <textarea id={`${fieldId}-notes`} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} rows={3} disabled={submitting}
                className="border-input bg-transparent focus-visible:ring-ring w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none" />
            </div>
          </CardContent>
        </Card>

        {error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}

        <div className="flex flex-col gap-2 sm:flex-row">
          <Button type="submit" disabled={submitting}>
            {submitting ? 'Saving…' : mode === 'edit' ? 'Save changes' : 'Create production'}
          </Button>
          <Button asChild type="button" variant="outline" disabled={submitting}>
            <Link to={existing ? paths.production(existing.production_id) : paths.productions}>Cancel</Link>
          </Button>
        </div>
      </form>
    </div>
  )
}
