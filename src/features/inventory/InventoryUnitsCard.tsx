import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ListPlus, Plus } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { CONDITION_LABELS } from '@/domain/inventory'
import { UNIT_STATUS_LABELS, unitBadgeVariant } from '@/features/inventory/inventory-unit-view'
import { BulkGenerateUnitsDialog } from '@/features/inventory/BulkGenerateUnitsDialog'
import { InventoryUnitDialog } from '@/features/inventory/InventoryUnitDialog'
import { teamNameOf } from '@/features/inventory/inventory-view'
import { useOrganization } from '@/features/organizations/useOrganization'
import { listAssetCodes, listUnitsForItem } from '@/services/inventory-unit-service'
import { toOrganizationErrorMessage } from '@/services/organization-errors-view'
import type { InventoryItem, InventoryUnit } from '@/types/inventory'
import { paths } from '@/routes/paths'

interface Props {
  item: InventoryItem
  canEdit: boolean
  /** Refreshes the parent item, whose totals move whenever a unit does. */
  onUnitsChanged: () => Promise<void> | void
}

/**
 * Every physical unit of a serialized item.
 *
 * The item's totals are not editable from here or anywhere else — they are
 * counted from these rows, and a unit write moves both in one transaction.
 */
export function InventoryUnitsCard({ item, canEdit, onUnitsChanged }: Props) {
  const { teams } = useOrganization()
  const [units, setUnits] = useState<InventoryUnit[] | undefined>(undefined)
  const [codes, setCodes] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [editing, setEditing] = useState<InventoryUnit | null>(null)

  const load = useCallback((): Promise<void> => {
    async function read() {
      const units = await listUnitsForItem({
        organizationId: item.organization_id,
        itemId: item.item_id,
      })
      // Codes are organization-wide, so a duplicate can be spotted across items.
      const codes = await listAssetCodes(item.organization_id).catch(() => [])
      return { units, codes }
    }

    return read().then(
      (loaded) => { setUnits(loaded.units); setCodes(loaded.codes); setError(null) },
      (caught: unknown) => { setError(toOrganizationErrorMessage(caught)); setUnits([]) },
    )
  }, [item.organization_id, item.item_id])

  useEffect(() => {
    void load()
  }, [load])

  const refresh = useCallback(async () => {
    await load()
    await onUnitsChanged()
  }, [load, onUnitsChanged])

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1.5">
            <CardTitle className="text-base">Units</CardTitle>
            <CardDescription>
              Every physical piece, tracked on its own — each with its own team, location, and
              status. The totals above are counted from these.
            </CardDescription>
          </div>
          {canEdit ? (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => setGenerating(true)}>
                <ListPlus className="size-4" aria-hidden="true" />
                Generate
              </Button>
              <Button size="sm" onClick={() => setAdding(true)}>
                <Plus className="size-4" aria-hidden="true" />
                Add unit
              </Button>
            </div>
          ) : null}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {error ? (
          <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>
        ) : null}

        {units === undefined ? (
          <p className="text-muted-foreground text-sm">Loading units…</p>
        ) : units.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No units yet.{' '}
            {canEdit
              ? 'Add them one at a time, or generate a numbered run.'
              : 'Someone on the owning team can add them.'}
          </p>
        ) : (
          <>
            {/* Cards on a phone, a table once there is room for one. */}
            <ul className="space-y-2 sm:hidden">
              {units.map((unit) => (
                <li key={unit.unit_id} className="rounded-md border p-3">
                  <div className="flex items-start justify-between gap-2">
                    <Link
                      to={paths.inventoryUnit(unit.unit_id)}
                      className="font-mono text-sm font-medium hover:underline"
                    >
                      {unit.asset_code}
                    </Link>
                    <Badge variant={unitBadgeVariant(unit.status)}>
                      {UNIT_STATUS_LABELS[unit.status]}
                    </Badge>
                  </div>
                  <p className="text-muted-foreground mt-1 text-sm">
                    {teamNameOf(unit, teams)} · {CONDITION_LABELS[unit.condition]}
                  </p>
                  <p className="text-muted-foreground text-sm">{unit.storage_location}</p>
                </li>
              ))}
            </ul>

            <div className="hidden sm:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Asset code</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Owning team</TableHead>
                    <TableHead>Condition</TableHead>
                    <TableHead>Location</TableHead>
                    {canEdit ? <TableHead className="w-0" /> : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {units.map((unit) => (
                    <TableRow key={unit.unit_id}>
                      <TableCell className="font-mono">
                        <Link
                          to={paths.inventoryUnit(unit.unit_id)}
                          className="font-medium hover:underline"
                        >
                          {unit.asset_code}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Badge variant={unitBadgeVariant(unit.status)}>
                          {UNIT_STATUS_LABELS[unit.status]}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {teamNameOf(unit, teams)}
                      </TableCell>
                      <TableCell>{CONDITION_LABELS[unit.condition]}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {unit.storage_location}
                      </TableCell>
                      {canEdit ? (
                        <TableCell>
                          <Button size="sm" variant="ghost" onClick={() => setEditing(unit)}>
                            Edit
                          </Button>
                        </TableCell>
                      ) : null}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </CardContent>

      {adding ? (
        <InventoryUnitDialog
          item={item}
          existing={null}
          usedCodes={codes}
          open={adding}
          onOpenChange={setAdding}
          onSaved={refresh}
        />
      ) : null}

      {editing ? (
        <InventoryUnitDialog
          item={item}
          existing={editing}
          usedCodes={codes}
          open={editing !== null}
          onOpenChange={(open) => { if (!open) setEditing(null) }}
          onSaved={refresh}
        />
      ) : null}

      {generating ? (
        <BulkGenerateUnitsDialog
          item={item}
          usedCodes={codes}
          open={generating}
          onOpenChange={setGenerating}
          onSaved={refresh}
        />
      ) : null}
    </Card>
  )
}
