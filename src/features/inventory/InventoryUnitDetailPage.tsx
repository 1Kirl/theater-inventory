import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Pencil } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useOrganization } from '@/features/organizations/useOrganization'
import { canEditTeamScopedRecord } from '@/domain/module-access'
import { CONDITION_LABELS } from '@/domain/inventory'
import { UNIT_STATUS_LABELS, unitBadgeVariant } from '@/features/inventory/inventory-unit-view'
import { InventoryUnitDialog } from '@/features/inventory/InventoryUnitDialog'
import { getInventoryItem } from '@/services/inventory-service'
import { getInventoryUnit, listAssetCodes } from '@/services/inventory-unit-service'
import { toOrganizationErrorMessage } from '@/services/organization-errors-view'
import type { InventoryItem, InventoryUnit } from '@/types/inventory'
import { paths } from '@/routes/paths'

/**
 * One physical unit.
 *
 * Its parent is loaded alongside it because the unit's own document does not
 * carry the item name, and because editing a unit needs the item the write is
 * counted against.
 */
export function InventoryUnitDetailPage() {
  const { unitId } = useParams<{ unitId: string }>()
  const { organization, membership, role, teams } = useOrganization()

  const [unit, setUnit] = useState<InventoryUnit | null | undefined>(undefined)
  const [item, setItem] = useState<InventoryItem | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [codes, setCodes] = useState<string[]>([])

  const load = useCallback((): Promise<void> => {
    if (!unitId) return Promise.resolve()

    async function read() {
      const unit = await getInventoryUnit(unitId as string)
      const item = unit ? await getInventoryItem(unit.inventory_item_id) : null
      const codes = unit ? await listAssetCodes(unit.organization_id).catch(() => []) : []
      return { unit, item, codes }
    }

    return read().then(
      (loaded) => {
        setUnit(loaded.unit); setItem(loaded.item); setCodes(loaded.codes); setError(null)
      },
      (caught: unknown) => { setError(toOrganizationErrorMessage(caught)); setUnit(null) },
    )
  }, [unitId])

  useEffect(() => {
    void load()
  }, [load])

  if (unit === undefined) {
    return <p className="text-muted-foreground text-sm">Loading unit…</p>
  }

  if (error) {
    return <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>
  }

  if (!unit || unit.organization_id !== organization?.organization_id) {
    return (
      <div className="space-y-4">
        <Alert variant="destructive">
          <AlertDescription>That unit was not found in this organization.</AlertDescription>
        </Alert>
        <Button asChild variant="outline" size="sm">
          <Link to={paths.inventory}>Back to inventory</Link>
        </Button>
      </div>
    )
  }

  const canEdit = canEditTeamScopedRecord(role, membership, 'inventory', unit.team_id)
  const teamName = teams.find((team) => team.team_id === unit.team_id)?.name ?? 'Unknown team'

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link to={paths.inventoryItem(unit.inventory_item_id)}>
            <ArrowLeft className="size-4" aria-hidden="true" />
            {item ? item.name : 'Item'}
          </Link>
        </Button>

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <h1 className="font-mono text-2xl font-semibold tracking-tight">{unit.asset_code}</h1>
            <p className="text-muted-foreground text-sm">
              {item ? `${item.name} · ` : ''}{teamName}
            </p>
          </div>
          {canEdit && item ? (
            <Button size="sm" onClick={() => setEditing(true)}>
              <Pencil className="size-4" aria-hidden="true" />
              Edit
            </Button>
          ) : null}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">This unit</CardTitle>
          <CardDescription>
            This unit&rsquo;s own team, condition, and whereabouts. Status follows what happens to
            the equipment; condition is recorded by hand.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4 sm:grid-cols-4">
            <div>
              <dt className="text-muted-foreground text-sm">Status</dt>
              <dd className="pt-1">
                <Badge variant={unitBadgeVariant(unit.status)}>
                  {UNIT_STATUS_LABELS[unit.status]}
                </Badge>
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-sm">Condition</dt>
              <dd className="pt-1">
                <Badge variant="secondary">{CONDITION_LABELS[unit.condition]}</Badge>
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-sm">Owning team</dt>
              <dd className="pt-1 text-sm">{teamName}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-sm">Stored</dt>
              <dd className="pt-1 text-sm">{unit.storage_location}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      {unit.notes ? (
        <Card>
          <CardHeader><CardTitle className="text-base">Notes</CardTitle></CardHeader>
          <CardContent>
            <p className="text-sm whitespace-pre-wrap">{unit.notes}</p>
          </CardContent>
        </Card>
      ) : null}

      {editing && item ? (
        <InventoryUnitDialog
          item={item}
          existing={unit}
          usedCodes={codes}
          open={editing}
          onOpenChange={setEditing}
          onSaved={load}
        />
      ) : null}
    </div>
  )
}
