import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Pencil } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { useOrganization } from '@/features/organizations/useOrganization'
import { canEditTeamScopedRecord } from '@/domain/module-access'
import { CONDITION_KEYS, CONDITION_LABELS } from '@/domain/inventory'
import { conditionSummaryLabel, teamNameOf, unclassifiedOf } from '@/features/inventory/inventory-view'
import { getInventoryItem } from '@/services/inventory-service'
import { toOrganizationErrorMessage } from '@/services/organization-errors-view'
import type { InventoryItem } from '@/types/inventory'
import { paths } from '@/routes/paths'

export function InventoryItemDetailPage() {
  const { itemId } = useParams<{ itemId: string }>()
  const { organization, membership, role, teams } = useOrganization()

  const [item, setItem] = useState<InventoryItem | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!itemId) return
    setError(null)
    try {
      setItem(await getInventoryItem(itemId))
    } catch (caught) {
      setError(toOrganizationErrorMessage(caught))
      setItem(null)
    }
  }, [itemId])

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
          <dl className="grid gap-4 sm:grid-cols-3">
            <div>
              <dt className="text-muted-foreground text-sm">Available</dt>
              <dd className="text-2xl font-semibold tabular-nums">{item.quantity_available}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-sm">Total</dt>
              <dd className="text-2xl font-semibold tabular-nums">{item.quantity_total}</dd>
            </div>
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
          <CardTitle className="text-base">Maintenance history</CardTitle>
          <CardDescription>Built in Phase 4.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">
            Repair and service records for this item will appear here.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
