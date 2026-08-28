import { useMemo, useState } from 'react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  MAX_LABELS_PER_PRINT, isDefaultLabelSelection, matchesLabelSearch, printableLabels,
  validateLabelSelection,
} from '@/features/inventory/equipment-label'
import { UNIT_STATUS_LABELS } from '@/features/inventory/inventory-unit-view'
import { useOrganization } from '@/features/organizations/useOrganization'
import type { EquipmentLabel } from '@/features/inventory/equipment-label'
import type { InventoryItem, InventoryUnit } from '@/types/inventory'

interface Props {
  item: InventoryItem
  units: readonly InventoryUnit[]
  open: boolean
  onOpenChange: (open: boolean) => void
  /**
   * Hands the finished sheet to whoever owns the printer. This dialog does not
   * print: a Radix modal disables pointer events on everything outside itself,
   * so a print sheet rendered here would be unclickable and the first click
   * would dismiss the dialog instead. The sheet is prepared here and printed
   * from the page, which is the same path the single-label button uses.
   */
  onPrint: (labels: EquipmentLabel[]) => void
}

/**
 * Printing a sheet of labels for a run of equipment.
 *
 * Printing writes nothing, so nothing here is guarded beyond being able to see
 * the units in the first place — a label carries only what is already on the
 * screen of anyone who can open this page.
 *
 * Retired units start unticked rather than hidden. Their codes never stopped
 * working, so reprinting an archive stays possible; it is simply not what a
 * reprint run is usually for.
 */
export function PrintLabelsDialog({ item, units, open, onOpenChange, onPrint }: Props) {
  const { organization } = useOrganization()

  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(units.filter(isDefaultLabelSelection).map((unit) => unit.unit_id)),
  )
  const visible = useMemo(
    () => units.filter((unit) => matchesLabelSearch(unit, search)),
    [units, search],
  )

  const selection = validateLabelSelection({ units, selectedIds: [...selected] })

  function toggle(unitId: string, next: boolean) {
    setSelected((current) => {
      const updated = new Set(current)
      if (next) updated.add(unitId)
      else updated.delete(unitId)
      return updated
    })
  }

  // Bulk ticking follows what is on screen, not the whole item: with a search
  // typed, "select all" that quietly reached past the filter would print labels
  // the person never saw.
  function setAllVisible(next: boolean) {
    setSelected((current) => {
      const updated = new Set(current)
      for (const unit of visible) {
        if (next) updated.add(unit.unit_id)
        else updated.delete(unit.unit_id)
      }
      return updated
    })
  }

  // Prepared here, while the units and the selection are still in hand.
  const labels = printableLabels({ units, selectedIds: [...selected], item, organization })

  const visibleAllSelected = visible.length > 0
    && visible.every((unit) => selected.has(unit.unit_id))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Print labels for {item.name}</DialogTitle>
          <DialogDescription>
            One sticker per piece of equipment, each with the code that opens its page. Up to
            {' '}{MAX_LABELS_PER_PRINT} at a time.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="space-y-2">
            <Label htmlFor="label-search">Find equipment</Label>
            <Input
              id="label-search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Asset code or storage location"
              autoComplete="off"
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-muted-foreground text-sm">
              {selected.size} selected
              {visible.length === units.length
                ? ''
                : ` · ${String(visible.length)} of ${String(units.length)} shown`}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={visible.length === 0}
              onClick={() => { setAllVisible(!visibleAllSelected) }}
            >
              {visibleAllSelected ? 'Clear these' : 'Select these'}
            </Button>
          </div>

          <div className="max-h-[45vh] space-y-1 overflow-y-auto rounded-md border p-1">
            {visible.length === 0 ? (
              <p className="text-muted-foreground p-3 text-sm">
                No equipment matches that.
              </p>
            ) : (
              visible.map((unit) => (
                <label
                  key={unit.unit_id}
                  className="hover:bg-muted/50 flex cursor-pointer items-center gap-3 rounded-md p-2"
                >
                  <Checkbox
                    checked={selected.has(unit.unit_id)}
                    onCheckedChange={(next) => { toggle(unit.unit_id, next === true) }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block font-mono text-sm">{unit.asset_code}</span>
                    <span className="text-muted-foreground block text-xs">
                      {UNIT_STATUS_LABELS[unit.status]}
                      {unit.storage_location ? ` · ${unit.storage_location}` : ''}
                    </span>
                  </span>
                </label>
              ))
            )}
          </div>

          {selection.valid ? null : (
            <Alert variant="destructive">
              <AlertDescription>{selection.message}</AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => { onOpenChange(false) }}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={labels === null}
            onClick={() => { if (labels) onPrint(labels) }}
          >
            Print {labels?.length ?? 0} label{labels?.length === 1 ? '' : 's'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
