import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Pencil } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Badge as StatusBadge } from '@/components/ui/badge'
import { useOrganization } from '@/features/organizations/useOrganization'
import { canEditTeamScopedRecord, hasModuleAccess } from '@/domain/module-access'
import { CONDITION_KEYS, CONDITION_LABELS } from '@/domain/inventory'
import { currentlyInService, isOverdue } from '@/domain/maintenance'
import { conditionSummaryLabel, teamNameOf, unclassifiedOf } from '@/features/inventory/inventory-view'
import { statusLabel, statusTone } from '@/features/maintenance/maintenance-view'
import { getInventoryItem } from '@/services/inventory-service'
import { listMaintenanceRecordsForItem } from '@/services/maintenance-service'
import { toOrganizationErrorMessage } from '@/services/organization-errors-view'
import type { InventoryItem } from '@/types/inventory'
import type { MaintenanceRecord } from '@/types/maintenance'
import { paths } from '@/routes/paths'

export function InventoryItemDetailPage() {
  const { itemId } = useParams<{ itemId: string }>()
  const { organization, membership, role, teams } = useOrganization()

  const [item, setItem] = useState<InventoryItem | null | undefined>(undefined)
  const [records, setRecords] = useState<MaintenanceRecord[]>([])
  const [error, setError] = useState<string | null>(null)

  // In Service is derived from maintenance data, so it follows the maintenance
  // permission — the same principle as the dashboard cards. Without it Rules
  // would refuse the read anyway, so there would be no number to show.
  const canSeeMaintenance = hasModuleAccess(
    role,
    membership?.permissions ?? null,
    'maintenance',
    'view',
  )
  const canEditMaintenance = hasModuleAccess(
    role,
    membership?.permissions ?? null,
    'maintenance',
    'edit',
  )

  // State settles in the promise continuations rather than synchronously, so
  // the effect starts the read and nothing else. Returning the promise keeps
  // `load` awaitable for callers that refresh after a write.
  const load = useCallback((): Promise<void> => {
    if (!itemId) return Promise.resolve()

    async function read() {
      const item = await getInventoryItem(itemId as string)

      // The repair history follows the maintenance permission, not this page's.
      const records = item && canSeeMaintenance
        ? await listMaintenanceRecordsForItem({
          organizationId: item.organization_id,
          itemId: item.item_id,
        }).catch(() => [])
        : []

      return { item, records }
    }

    return read().then(
      (loaded) => { setItem(loaded.item); setRecords(loaded.records); setError(null) },
      (caught: unknown) => { setError(toOrganizationErrorMessage(caught)); setItem(null) },
    )
  }, [itemId, canSeeMaintenance])

  useEffect(() => {
    void load()
  }, [load])

  if (item === undefined) {
    return <p className="text-muted-foreground text-sm">Loading item…</p>
  }

  if (error) {
    return <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>
  }

  if (!item || item.organization_id !== organization?.organization_id) {
    return (
      <div className="space-y-4">
        <Alert variant="destructive">
          <AlertDescription>That inventory item was not found in this organization.</AlertDescription>
        </Alert>
        <Button asChild variant="outline" size="sm">
          <Link to={paths.inventory}>Back to inventory</Link>
        </Button>
      </div>
    )
  }

  const canEdit = canEditTeamScopedRecord(role, membership, 'inventory', item.team_id)
  const unclassified = unclassifiedOf(item)
  const inService = currentlyInService(records)
  const now = new Date()

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link to={paths.inventory}>
            <ArrowLeft className="size-4" aria-hidden="true" />
            Inventory
          </Link>
        </Button>

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">{item.name}</h1>
            <p className="text-muted-foreground text-sm">
              {item.category} · {teamNameOf(item, teams)}
            </p>
          </div>
          {canEdit ? (
            <Button asChild size="sm">
              <Link to={paths.inventoryItemEdit(item.item_id)}>
                <Pencil className="size-4" aria-hidden="true" />
                Edit
              </Link>
            </Button>
          ) : null}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Quantity</CardTitle>
          <CardDescription>
            Available quantity is maintained by hand. Nothing else changes it.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <dl className={canSeeMaintenance ? 'grid gap-4 sm:grid-cols-4' : 'grid gap-4 sm:grid-cols-3'}>
            <div>
              <dt className="text-muted-foreground text-sm">Total</dt>
              <dd className="text-2xl font-semibold tabular-nums">{item.quantity_total}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-sm">Available</dt>
              <dd className="text-2xl font-semibold tabular-nums">{item.quantity_available}</dd>
            </div>
            {canSeeMaintenance ? (
              <div>
                <dt className="text-muted-foreground text-sm">In service</dt>
                <dd className="text-2xl font-semibold tabular-nums">{inService}</dd>
              </div>
            ) : null}
            <div>
              <dt className="text-muted-foreground text-sm">Condition</dt>
              <dd className="pt-1"><Badge variant="secondary">{conditionSummaryLabel(item)}</Badge></dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Condition breakdown</CardTitle>
          <CardDescription>
            The summary above is the worst state holding at least one unit.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-3 sm:grid-cols-3">
            {CONDITION_KEYS.map((key) => (
              <div key={key} className="flex items-baseline justify-between gap-2 sm:block">
                <dt className="text-muted-foreground text-sm">{CONDITION_LABELS[key]}</dt>
                <dd className="font-medium tabular-nums">{item.condition_counts[key]}</dd>
              </div>
            ))}
            <div className="flex items-baseline justify-between gap-2 sm:block">
              <dt className="text-muted-foreground text-sm">Unclassified</dt>
              <dd className="font-medium tabular-nums">{unclassified}</dd>
            </div>
          </dl>
          {unclassified > 0 ? (
            <>
              <Separator className="my-4" />
              <p className="text-muted-foreground text-xs">
                {unclassified} unit{unclassified === 1 ? '' : 's'} have not been classified into a
                condition yet.
              </p>
            </>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Details</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground text-sm">Storage location</dt>
              <dd className="font-medium">{item.location}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-sm">Owning team</dt>
              <dd className="font-medium">{teamNameOf(item, teams)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-sm">Last inspected</dt>
              <dd className="font-medium">
                {item.last_inspected_at ? item.last_inspected_at.toDate().toLocaleDateString() : 'Never'}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-sm">Last updated</dt>
              <dd className="font-medium">
                {item.updated_at ? item.updated_at.toDate().toLocaleDateString() : '—'}
              </dd>
            </div>
            {item.notes ? (
              <div className="sm:col-span-2">
                <dt className="text-muted-foreground text-sm">Notes</dt>
                <dd className="whitespace-pre-wrap">{item.notes}</dd>
              </div>
            ) : null}
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <CardTitle className="text-base">Maintenance history</CardTitle>
              <CardDescription>
                {canSeeMaintenance
                  ? 'Repairs stay in history permanently, including returned ones.'
                  : null}
              </CardDescription>
            </div>
            {canSeeMaintenance && canEditMaintenance ? (
              <Button asChild variant="outline" size="sm">
                <Link to={`${paths.maintenanceNew}?item=${item.item_id}`}>Add repair record</Link>
              </Button>
            ) : null}
          </div>
        </CardHeader>
        <CardContent>
          {!canSeeMaintenance ? (
            <p className="text-muted-foreground text-sm">
              Maintenance access required. Ask your Admin if you need to see repair history for this
              item.
            </p>
          ) : records.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No repair records for this item yet.
            </p>
          ) : (
            <ul className="divide-border divide-y">
              {records.map((record) => {
                const tone = statusTone(record.status)
                return (
                  <li key={record.maintenance_id} className="py-3">
                    <Link
                      to={paths.maintenanceRecord(record.maintenance_id)}
                      className="flex flex-wrap items-center gap-x-3 gap-y-1"
                    >
                      <StatusBadge
                        variant={tone === 'active' ? 'default' : tone === 'pending' ? 'outline' : 'secondary'}
                      >
                        {statusLabel(record.status)}
                      </StatusBadge>
                      {isOverdue(record, now) ? (
                        <StatusBadge variant="destructive">Overdue</StatusBadge>
                      ) : null}
                      <span className="text-sm tabular-nums">{record.quantity_sent} unit
                        {record.quantity_sent === 1 ? '' : 's'}</span>
                      <span className="text-muted-foreground min-w-0 flex-1 truncate text-sm">
                        {record.issue_description}
                      </span>
                      <span className="text-muted-foreground text-xs">
                        {record.service_provider_name ?? 'No provider'}
                      </span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
