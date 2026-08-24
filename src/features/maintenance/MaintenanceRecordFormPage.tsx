import { useCallback, useEffect, useId, useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Timestamp } from 'firebase/firestore'
import { AlertTriangle, ArrowLeft } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useOrganization } from '@/features/organizations/useOrganization'
import { canEditTeamScopedRecord } from '@/domain/module-access'
import {
  MAINTENANCE_STATUS_LABELS,
  overCapacityWarning,
  validateQuantitySent,
  type OverCapacityWarning,
} from '@/domain/maintenance'
import { teamNameById } from '@/features/maintenance/maintenance-view'
import { listInventoryItems } from '@/services/inventory-service'
import {
  createMaintenanceRecord,
  getMaintenanceRecord,
  listMaintenanceRecordsForItem,
  updateMaintenanceRecord,
} from '@/services/maintenance-service'
import { toDateKey } from '@/domain/calendar'
import { toOrganizationErrorMessage } from '@/services/organization-errors-view'
import {
  MAINTENANCE_STATUSES,
  RETURN_METHODS,
  type MaintenanceRecord,
  type MaintenanceStatus,
  type ReturnMethod,
} from '@/types/maintenance'
import type { InventoryItem } from '@/types/inventory'
import { paths } from '@/routes/paths'

interface FormState {
  itemId: string
  quantitySent: string
  issueDescription: string
  status: MaintenanceStatus
  sentAt: string
  returnMethod: string
  expectedReturnAt: string
  returnedAt: string
  providerName: string
  providerPhone: string
  providerEmail: string
  cost: string
  repairNotes: string
}

const BLANK: FormState = {
  itemId: '',
  quantitySent: '1',
  issueDescription: '',
  status: 'planned',
  sentAt: '',
  returnMethod: '',
  expectedReturnAt: '',
  returnedAt: '',
  providerName: '',
  providerPhone: '',
  providerEmail: '',
  cost: '',
  repairNotes: '',
}

function toDate(value: string): Timestamp | null {
  return value ? Timestamp.fromDate(new Date(`${value}T00:00:00`)) : null
}

/**
 * The inverse of `toDate` above, which parses the input value as *local*
 * midnight. `toISOString` would answer in UTC, so a date read back into the
 * form would land on the previous day for anyone east of Greenwich, and saving
 * again would walk it back another day.
 */
function fromDate(stamp: MaintenanceRecord['sent_at']): string {
  return stamp ? toDateKey(stamp.toDate()) : ''
}

export function MaintenanceRecordFormPage({ mode }: { mode: 'create' | 'edit' }) {
  const navigate = useNavigate()
  const { recordId } = useParams<{ recordId: string }>()
  const [searchParams] = useSearchParams()
  const { organization, membership, role, teams } = useOrganization()
  const fieldId = useId()

  const [state, setState] = useState<FormState>(BLANK)
  const [existing, setExisting] = useState<MaintenanceRecord | null>(null)
  const [items, setItems] = useState<InventoryItem[]>([])
  const [siblings, setSiblings] = useState<MaintenanceRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  /**
   * Admin may file against any item; a maintenance editor only against items
   * owned by one of their teams, because the record inherits that team and edit
   * scope follows it.
   */
  const selectableItems = useMemo(() => {
    if (role === 'admin') return items
    const own = new Set(membership?.team_ids ?? [])
    return items.filter((item) => own.has(item.team_id))
  }, [items, role, membership])

  const selectedItem = items.find((item) => item.item_id === state.itemId) ?? null

  // State settles in the promise continuations rather than synchronously, so
  // the effect starts the read and nothing else.
  const load = useCallback((): Promise<void> => {
    if (!organization) return Promise.resolve()
    const organizationId = organization.organization_id

    async function read() {
      const items = await listInventoryItems(organizationId)

      if (mode !== 'edit' || !recordId) return { items, record: null }

      const record = await getMaintenanceRecord(recordId)
      if (!record || record.organization_id !== organizationId) {
        throw new Error('not-in-organization')
      }

      return { items, record }
    }

    return read().then(
      ({ items, record }) => {
        setItems(items)
        setLoading(false)

        if (!record) {
          const preselected = searchParams.get('item')
          if (preselected) setState((current) => ({ ...current, itemId: preselected }))
          return
        }

        setExisting(record)
        setState({
          itemId: record.item_id,
          quantitySent: String(record.quantity_sent),
          issueDescription: record.issue_description,
          status: record.status,
          sentAt: fromDate(record.sent_at),
          returnMethod: record.return_method ?? '',
          expectedReturnAt: fromDate(record.expected_return_at),
          returnedAt: fromDate(record.returned_at),
          providerName: record.service_provider_name ?? '',
          providerPhone: record.service_provider_phone ?? '',
          providerEmail: record.service_provider_email ?? '',
          cost: typeof record.cost === 'number' ? String(record.cost) : '',
          repairNotes: record.repair_notes ?? '',
        })
      },
      (caught: unknown) => {
        setLoading(false)
        setError(
          caught instanceof Error && caught.message === 'not-in-organization'
            ? 'That maintenance record was not found in this organization.'
            : toOrganizationErrorMessage(caught),
        )
      },
    )
  }, [organization, mode, recordId, searchParams])

  useEffect(() => {
    void load()
  }, [load])

  // The item's other records are what the over-capacity warning is measured
  // against. Loaded per item, not for the whole organization.
  useEffect(() => {
    // Resolve to an empty list rather than clearing synchronously, so the
    // effect only settles state in a continuation.
    const pending = organization && state.itemId
      ? listMaintenanceRecordsForItem({
        organizationId: organization.organization_id,
        itemId: state.itemId,
      })
      : Promise.resolve([])

    let cancelled = false
    pending.then(
      (loaded) => { if (!cancelled) setSiblings(loaded) },
      () => { if (!cancelled) setSiblings([]) },
    )

    return () => { cancelled = true }
  }, [organization, state.itemId])

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setState((current) => ({ ...current, [key]: value }))
  }

  const quantity = Number(state.quantitySent)

  const warning: OverCapacityWarning | null = useMemo(() => {
    if (!selectedItem || !Number.isInteger(quantity) || quantity <= 0) return null
    return overCapacityWarning({
      existingRecords: siblings,
      editingRecordId: existing?.maintenance_id,
      status: state.status,
      quantitySent: quantity,
      itemQuantityTotal: selectedItem.quantity_total,
    })
  }, [selectedItem, siblings, existing, state.status, quantity])

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (submitting || !organization) return

    setError(null)

    if (!selectedItem) {
      setError('Choose the inventory item this repair is for.')
      return
    }

    const quantityCheck = validateQuantitySent({
      quantitySent: quantity,
      itemQuantityTotal: selectedItem.quantity_total,
    })
    if (!quantityCheck.valid) {
      setError(quantityCheck.message)
      return
    }

    if (state.issueDescription.trim().length === 0) {
      setError('Describe what is wrong with the equipment.')
      return
    }

    const input = {
      quantitySent: quantity,
      issueDescription: state.issueDescription,
      status: state.status,
      sentAt: toDate(state.sentAt),
      returnMethod: (state.returnMethod || null) as ReturnMethod | null,
      expectedReturnAt: toDate(state.expectedReturnAt),
      returnedAt: toDate(state.returnedAt),
      serviceProviderName: state.providerName,
      serviceProviderPhone: state.providerPhone,
      serviceProviderEmail: state.providerEmail,
      cost: state.cost.trim() ? Number(state.cost) : null,
      repairNotes: state.repairNotes,
    }

    setSubmitting(true)
    try {
      if (mode === 'edit' && existing) {
        await updateMaintenanceRecord({ existing, input })
        navigate(paths.maintenanceRecord(existing.maintenance_id), { replace: true })
      } else {
        const { maintenanceId } = await createMaintenanceRecord({
          organizationId: organization.organization_id,
          itemId: selectedItem.item_id,
          input,
        })
        navigate(paths.maintenanceRecord(maintenanceId), { replace: true })
      }
    } catch (caught) {
      setError(toOrganizationErrorMessage(caught))
      setSubmitting(false)
    }
  }

  if (loading) {
    return <p className="text-muted-foreground text-sm">Loading maintenance record…</p>
  }

  if (mode === 'edit' && existing && !canEditTeamScopedRecord(role, membership, 'maintenance', existing.team_id)) {
    return (
      <div className="space-y-4">
        <Alert variant="destructive">
          <AlertDescription>
            This record belongs to {teamNameById(existing.team_id, teams)}. You can view it, but only
            that team — or an Admin — can change it.
          </AlertDescription>
        </Alert>
        <Button asChild variant="outline" size="sm">
          <Link to={paths.maintenanceRecord(existing.maintenance_id)}>Back to record</Link>
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link to={existing ? paths.maintenanceRecord(existing.maintenance_id) : paths.maintenance}>
          <ArrowLeft className="size-4" aria-hidden="true" />
          Cancel
        </Link>
      </Button>

      <h1 className="text-2xl font-semibold tracking-tight">
        {mode === 'edit' ? 'Edit repair record' : 'Add repair record'}
      </h1>

      <form onSubmit={handleSubmit} className="space-y-6" noValidate>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Equipment</CardTitle>
            <CardDescription>
              The owning team comes from the item and is recorded permanently. It cannot be chosen
              or changed here.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor={`${fieldId}-item`}>Inventory item</Label>
              {mode === 'edit' ? (
                <p className="text-sm font-medium">{selectedItem?.name ?? 'Unknown item'}</p>
              ) : (
                <Select value={state.itemId} onValueChange={(value) => set('itemId', value)} disabled={submitting}>
                  <SelectTrigger id={`${fieldId}-item`}><SelectValue placeholder="Choose an item" /></SelectTrigger>
                  <SelectContent>
                    {selectableItems.map((item) => (
                      <SelectItem key={item.item_id} value={item.item_id}>
                        {item.name} — {teamNameById(item.team_id, teams)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {selectedItem ? (
                <p className="text-muted-foreground text-xs">
                  Owned by {teamNameById(selectedItem.team_id, teams)} · {selectedItem.quantity_total} in total
                </p>
              ) : mode === 'create' && selectableItems.length === 0 ? (
                <p className="text-muted-foreground text-xs">
                  No inventory items you can file a repair against yet.
                </p>
              ) : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor={`${fieldId}-quantity`}>Quantity sent</Label>
              <Input
                id={`${fieldId}-quantity`}
                type="number"
                min={1}
                step={1}
                value={state.quantitySent}
                onChange={(event) => set('quantitySent', event.target.value)}
                disabled={submitting}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor={`${fieldId}-status`}>Status</Label>
              <Select
                value={state.status}
                onValueChange={(value) => set('status', value as MaintenanceStatus)}
                disabled={submitting}
              >
                <SelectTrigger id={`${fieldId}-status`}><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MAINTENANCE_STATUSES.map((status) => (
                    <SelectItem key={status} value={status}>{MAINTENANCE_STATUS_LABELS[status]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor={`${fieldId}-issue`}>Issue</Label>
              <textarea
                id={`${fieldId}-issue`}
                value={state.issueDescription}
                onChange={(event) => set('issueDescription', event.target.value)}
                maxLength={1000}
                rows={3}
                disabled={submitting}
                required
                className="border-input bg-transparent focus-visible:ring-ring w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none"
              />
            </div>
          </CardContent>
        </Card>

        {warning ? (
          <Alert>
            <AlertTriangle className="size-4" aria-hidden="true" />
            <AlertTitle>More units in service than the item has</AlertTitle>
            <AlertDescription>
              {warning.message} You can still save this — the total is a guide, not a limit.
            </AlertDescription>
          </Alert>
        ) : null}

        <Card>
          <CardHeader><CardTitle className="text-base">Dates</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor={`${fieldId}-sent`}>Sent</Label>
              <Input id={`${fieldId}-sent`} type="date" value={state.sentAt} onChange={(event) => set('sentAt', event.target.value)} disabled={submitting} />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${fieldId}-expected`}>Expected back</Label>
              <Input id={`${fieldId}-expected`} type="date" value={state.expectedReturnAt} onChange={(event) => set('expectedReturnAt', event.target.value)} disabled={submitting} />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${fieldId}-returned`}>Returned</Label>
              <Input id={`${fieldId}-returned`} type="date" value={state.returnedAt} onChange={(event) => set('returnedAt', event.target.value)} disabled={submitting} />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${fieldId}-method`}>Return method</Label>
              <Select value={state.returnMethod} onValueChange={(value) => set('returnMethod', value)} disabled={submitting}>
                <SelectTrigger id={`${fieldId}-method`}><SelectValue placeholder="Not set" /></SelectTrigger>
                <SelectContent>
                  {RETURN_METHODS.map((method) => (
                    <SelectItem key={method} value={method} className="capitalize">{method}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Service provider</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor={`${fieldId}-provider`}>Name</Label>
              <Input id={`${fieldId}-provider`} value={state.providerName} onChange={(event) => set('providerName', event.target.value)} maxLength={120} disabled={submitting} />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${fieldId}-phone`}>Phone</Label>
              <Input id={`${fieldId}-phone`} value={state.providerPhone} onChange={(event) => set('providerPhone', event.target.value)} maxLength={120} disabled={submitting} />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${fieldId}-email`}>Email</Label>
              <Input id={`${fieldId}-email`} type="email" value={state.providerEmail} onChange={(event) => set('providerEmail', event.target.value)} maxLength={120} disabled={submitting} />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${fieldId}-cost`}>Cost</Label>
              <Input id={`${fieldId}-cost`} type="number" min={0} step="0.01" value={state.cost} onChange={(event) => set('cost', event.target.value)} disabled={submitting} />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor={`${fieldId}-notes`}>Repair notes</Label>
              <textarea
                id={`${fieldId}-notes`}
                value={state.repairNotes}
                onChange={(event) => set('repairNotes', event.target.value)}
                maxLength={2000}
                rows={3}
                disabled={submitting}
                className="border-input bg-transparent focus-visible:ring-ring w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none"
              />
            </div>
          </CardContent>
        </Card>

        {error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}

        <div className="flex flex-col gap-2 sm:flex-row">
          <Button type="submit" disabled={submitting || (mode === 'create' && selectableItems.length === 0)}>
            {submitting ? 'Saving…' : mode === 'edit' ? 'Save changes' : 'Create record'}
          </Button>
          <Button asChild type="button" variant="outline" disabled={submitting}>
            <Link to={existing ? paths.maintenanceRecord(existing.maintenance_id) : paths.maintenance}>Cancel</Link>
          </Button>
        </div>
      </form>
    </div>
  )
}
