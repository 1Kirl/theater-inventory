import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Pencil } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useOrganization } from '@/features/organizations/useOrganization'
import { canEditTeamScopedRecord } from '@/domain/module-access'
import { isOverdue } from '@/domain/maintenance'
import { statusLabel, statusTone, teamDisplay } from '@/features/maintenance/maintenance-view'
import { getInventoryItem } from '@/services/inventory-service'
import { getMaintenanceRecord } from '@/services/maintenance-service'
import { toOrganizationErrorMessage } from '@/services/organization-errors-view'
import type { MaintenanceRecord } from '@/types/maintenance'
import type { InventoryItem } from '@/types/inventory'
import { paths } from '@/routes/paths'

function formatDate(stamp: MaintenanceRecord['sent_at']): string {
  return stamp ? stamp.toDate().toLocaleDateString() : '—'
}

export function MaintenanceRecordDetailPage() {
  const { recordId } = useParams<{ recordId: string }>()
  const { organization, membership, role, teams } = useOrganization()

  const [record, setRecord] = useState<MaintenanceRecord | null | undefined>(undefined)
  const [item, setItem] = useState<InventoryItem | null>(null)
  const [error, setError] = useState<string | null>(null)

  // State settles in the promise continuations rather than synchronously, so
  // the effect starts the read and nothing else. Returning the promise keeps
  // `load` awaitable for callers that refresh after a write.
  const load = useCallback((): Promise<void> => {
    if (!recordId) return Promise.resolve()

    async function read() {
      const record = await getMaintenanceRecord(recordId as string)
      const item = record ? await getInventoryItem(record.item_id).catch(() => null) : null
      return { record, item }
    }

    return read().then(
      (loaded) => { setRecord(loaded.record); setItem(loaded.item); setError(null) },
      (caught: unknown) => { setError(toOrganizationErrorMessage(caught)); setRecord(null) },
    )
  }, [recordId])

  useEffect(() => {
    void load()
  }, [load])

  if (record === undefined) {
    return <p className="text-muted-foreground text-sm">Loading record…</p>
  }

  if (error) {
    return <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>
  }

  if (!record || record.organization_id !== organization?.organization_id) {
    return (
      <div className="space-y-4">
        <Alert variant="destructive">
          <AlertDescription>That maintenance record was not found in this organization.</AlertDescription>
        </Alert>
        <Button asChild variant="outline" size="sm"><Link to={paths.maintenance}>Back to maintenance</Link></Button>
      </div>
    )
  }

  // Edit scope follows the stored snapshot, not the item's current team.
  const canEdit = canEditTeamScopedRecord(role, membership, 'maintenance', record.team_id)
  const team = teamDisplay(record, item ? [item] : [], teams)
  const tone = statusTone(record.status)
  const overdue = isOverdue(record, new Date())

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link to={paths.maintenance}>
            <ArrowLeft className="size-4" aria-hidden="true" />
            Maintenance
          </Link>
        </Button>

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold tracking-tight">
              {item ? item.name : 'Maintenance record'}
            </h1>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={tone === 'active' ? 'default' : tone === 'pending' ? 'outline' : 'secondary'}>
                {statusLabel(record.status)}
              </Badge>
              {overdue ? <Badge variant="destructive">Overdue</Badge> : null}
            </div>
          </div>
          {canEdit ? (
            <Button asChild size="sm">
              <Link to={paths.maintenanceRecordEdit(record.maintenance_id)}>
                <Pencil className="size-4" aria-hidden="true" />
                Edit
              </Link>
            </Button>
          ) : null}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Service</CardTitle>
          {team.historical ? (
            <CardDescription>
              The item has since moved to another team. This record stays with the crew that sent it
              out.
            </CardDescription>
          ) : null}
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground text-sm">Inventory item</dt>
              <dd className="font-medium">
                {item ? (
                  <Link to={paths.inventoryItem(item.item_id)} className="underline underline-offset-4">
                    {item.name}
                  </Link>
                ) : (
                  'Unknown item'
                )}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-sm">
                {team.historical ? 'Team at time of service' : 'Team'}
              </dt>
              <dd className="font-medium">{team.name}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-sm">Quantity sent</dt>
              <dd className="text-xl font-semibold tabular-nums">{record.quantity_sent}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-sm">Return method</dt>
              <dd className="font-medium capitalize">{record.return_method ?? '—'}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-muted-foreground text-sm">Issue</dt>
              <dd className="whitespace-pre-wrap">{record.issue_description}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Dates</CardTitle></CardHeader>
        <CardContent>
          <dl className="grid gap-4 sm:grid-cols-3">
            <div>
              <dt className="text-muted-foreground text-sm">Sent</dt>
              <dd className="font-medium">{formatDate(record.sent_at)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-sm">Expected back</dt>
              <dd className="font-medium">{formatDate(record.expected_return_at)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-sm">Returned</dt>
              <dd className="font-medium">{formatDate(record.returned_at)}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Service provider</CardTitle></CardHeader>
        <CardContent>
          <dl className="grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground text-sm">Name</dt>
              <dd className="font-medium">{record.service_provider_name ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-sm">Phone</dt>
              <dd className="font-medium">{record.service_provider_phone ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-sm">Email</dt>
              <dd className="font-medium break-all">{record.service_provider_email ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-sm">Cost</dt>
              <dd className="font-medium tabular-nums">
                {typeof record.cost === 'number' ? record.cost.toFixed(2) : '—'}
              </dd>
            </div>
            {record.repair_notes ? (
              <div className="sm:col-span-2">
                <dt className="text-muted-foreground text-sm">Repair notes</dt>
                <dd className="whitespace-pre-wrap">{record.repair_notes}</dd>
              </div>
            ) : null}
          </dl>
        </CardContent>
      </Card>

      {record.status === 'returned' ? (
        <Alert>
          <AlertDescription>
            This equipment is back. Review the item's condition counts and available quantity —
            neither changes on its own.
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  )
}
