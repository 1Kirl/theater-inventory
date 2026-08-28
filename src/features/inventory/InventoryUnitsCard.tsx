import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ListPlus, Plus, Printer } from 'lucide-react'
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
import { PrintLabelsDialog } from '@/features/inventory/PrintLabelsDialog'
import { EquipmentLabelPrinter } from '@/features/inventory/EquipmentLabelPrinter'
import type { EquipmentLabel } from '@/features/inventory/equipment-label'
import { UnitLifecycleDialog } from '@/features/inventory/UnitLifecycleDialog'
import { unitMaintenanceIndicator, unitRowControls } from '@/features/inventory/unit-lifecycle-view'
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
  const { membership, role, teams } = useOrganization()
  const [units, setUnits] = useState<InventoryUnit[] | undefined>(undefined)
  const [codes, setCodes] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [editing, setEditing] = useState<InventoryUnit | null>(null)
  // Siblings, never nested: opening one closes the other. Radix focus traps
  // make stacked modals awkward, and nothing else in this project stacks them.
  const [managing, setManaging] = useState<InventoryUnit | null>(null)
  const [selectingLabels, setSelectingLabels] = useState(false)
  // The finished sheet, handed over by the selection dialog. Held here rather
  // than inside it because the printer must not live under a modal: Radix
  // disables pointer events outside an open dialog, which left the print sheet
  // unclickable and made the first click dismiss the dialog instead.
  const [labels, setLabels] = useState<EquipmentLabel[] | null>(null)

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
              status. Retired units stay here for their history and are counted separately above.
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            {units && units.length > 0 ? (
              <Button size="sm" variant="outline" onClick={() => setSelectingLabels(true)}>
                <Printer className="size-4" aria-hidden="true" />
                Print labels
              </Button>
            ) : null}
            {canEdit ? (
              <>
                <Button size="sm" variant="outline" onClick={() => setGenerating(true)}>
                  <ListPlus className="size-4" aria-hidden="true" />
                  Generate
                </Button>
                <Button size="sm" onClick={() => setAdding(true)}>
                  <Plus className="size-4" aria-hidden="true" />
                  Add unit
                </Button>
              </>
            ) : null}
          </div>
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
                  {unitMaintenanceIndicator(unit).label ? (
                    <p className="text-muted-foreground text-xs">
                      {unitMaintenanceIndicator(unit).label}
                    </p>
                  ) : null}
                  <p className="text-muted-foreground mt-1 text-sm">
                    {teamNameOf(unit, teams)} · {CONDITION_LABELS[unit.condition]}
                  </p>
                  <p className="text-muted-foreground text-sm">{unit.storage_location}</p>

                  <div className="mt-3 flex flex-wrap gap-2">
                    {unit.current_maintenance_record_id ? (
                      <Button asChild size="sm" variant="outline">
                        <Link to={paths.maintenanceRecord(unit.current_maintenance_record_id)}>
                          View repair
                        </Link>
                      </Button>
                    ) : null}
                    {unit.planned_maintenance_record_id ? (
                      <Button asChild size="sm" variant="outline">
                        <Link to={paths.maintenanceRecord(unit.planned_maintenance_record_id)}>
                          View plan
                        </Link>
                      </Button>
                    ) : null}
                    {unitRowControls({ unit, role, membership }).canManageStatus ? (
                      <Button size="sm" variant="outline" onClick={() => setManaging(unit)}>
                        Manage status
                      </Button>
                    ) : null}
                    {canEdit ? (
                      <Button size="sm" variant="outline" onClick={() => setEditing(unit)}>
                        Edit
                      </Button>
                    ) : null}
                    <Button asChild size="sm" variant="outline">
                      <Link to={paths.inventoryUnit(unit.unit_id)}>View details</Link>
                    </Button>
                  </div>
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
                    <TableHead className="w-0 text-right">Manage</TableHead>
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
                        {/* Secondary to the real status: a plan is an intention
                            about next week, not where the equipment is now. */}
                        {unitMaintenanceIndicator(unit).label ? (
                          <span className="text-muted-foreground mt-1 block text-xs">
                            {unitMaintenanceIndicator(unit).label}
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {teamNameOf(unit, teams)}
                      </TableCell>
                      <TableCell>{CONDITION_LABELS[unit.condition]}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {unit.storage_location}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        <div className="flex justify-end gap-1">
                          {unit.current_maintenance_record_id ? (
                            <Button asChild size="sm" variant="ghost">
                              <Link to={paths.maintenanceRecord(unit.current_maintenance_record_id)}>
                                View repair
                              </Link>
                            </Button>
                          ) : null}
                          {unit.planned_maintenance_record_id ? (
                            <Button asChild size="sm" variant="ghost">
                              <Link to={paths.maintenanceRecord(unit.planned_maintenance_record_id)}>
                                View plan
                              </Link>
                            </Button>
                          ) : null}
                          {unitRowControls({ unit, role, membership }).canManageStatus ? (
                            <Button size="sm" variant="ghost" onClick={() => setManaging(unit)}>
                              Manage status
                            </Button>
                          ) : null}
                          {canEdit ? (
                            <Button size="sm" variant="ghost" onClick={() => setEditing(unit)}>
                              Edit
                            </Button>
                          ) : null}
                          {/* An explicit way in. The asset code is also a link,
                              but a link that looks like a label is not a way
                              anybody finds. */}
                          <Button asChild size="sm" variant="ghost">
                            <Link to={paths.inventoryUnit(unit.unit_id)}>View details</Link>
                          </Button>
                        </div>
                      </TableCell>
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
          onManageStatus={() => {
            // Close the edit dialog before opening the lifecycle one, so the
            // two are never on screen together.
            const unit = editing
            setEditing(null)
            setManaging(unit)
          }}
        />
      ) : null}

      {managing ? (
        <UnitLifecycleDialog
          unit={managing}
          to={null}
          open={managing !== null}
          onOpenChange={(open) => { if (!open) setManaging(null) }}
          onDone={refresh}
        />
      ) : null}

      {/* Mounted on demand so the default selection is taken from units that
          have actually loaded. */}
      {selectingLabels && units ? (
        <PrintLabelsDialog
          item={item}
          units={units}
          open={selectingLabels}
          onOpenChange={setSelectingLabels}
          onPrint={(prepared) => {
            // The selection is finished, so the dialog goes and the sheet stays.
            // Printing then happens on an ordinary page with nothing modal above
            // it — byte for byte the path the single-label button takes.
            setSelectingLabels(false)
            setLabels(prepared)
          }}
        />
      ) : null}

      <EquipmentLabelPrinter
        labels={labels ?? []}
        open={labels !== null}
        onOpenChange={(open) => { if (!open) setLabels(null) }}
      />

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
