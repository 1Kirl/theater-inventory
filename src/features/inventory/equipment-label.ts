import { equipmentQrUrl, inventoryItemQrUrl } from '@/domain/equipment-links'
import type { InventoryItem, InventoryUnit } from '@/types/inventory'
import type { Organization } from '@/types/organization'

/**
 * What goes on a physical label.
 *
 * A sticker on a microphone is read months after it was printed, and nobody
 * reprints it when something changes. So it carries only what is true for as
 * long as the equipment exists: which piece it is, what kind of thing it is,
 * and whose it is.
 *
 * Everything that moves — status, condition, where it is kept, who has it, what
 * repair it is on — is deliberately absent. A label saying "Available" on a
 * microphone that has been lost for a month is worse than a label saying
 * nothing, because somebody will believe it.
 */
export interface EquipmentLabel {
  /** The link the QR encodes. Stable for the life of the unit. */
  qrUrl: string
  /** The code a person reads off the equipment. */
  assetCode: string
  /** What kind of thing it is. */
  itemName: string
  /** Whose it is, in smaller type. */
  organizationName: string
}

export function equipmentLabel(params: {
  unit: Pick<InventoryUnit, 'unit_id' | 'asset_code'>
  item: Pick<InventoryItem, 'name'> | null
  organization: Pick<Organization, 'name'> | null
}): EquipmentLabel {
  return {
    qrUrl: equipmentQrUrl(params.unit.unit_id),
    assetCode: params.unit.asset_code,
    itemName: params.item?.name ?? 'Equipment',
    organizationName: params.organization?.name ?? '',
  }
}

/**
 * The label for an inventory record rather than a physical piece.
 *
 * Reuses the same three lines, because a printed sticker is a printed sticker
 * and there is no reason for two layouts. What changes is what the top line
 * says: a unit's asset code identifies one microphone, and an item has no such
 * thing — so the line names what the label *is* instead of pretending to be a
 * code somebody could read off the equipment.
 *
 * A bulk item's label deliberately does not carry the quantity. Quantity is the
 * fastest-changing fact about a bulk item, and a sticker saying "20" on a hook
 * holding six is worse than a sticker saying nothing.
 */
export function inventoryItemLabel(params: {
  item: Pick<InventoryItem, 'item_id' | 'name' | 'tracking_mode'>
  organization: Pick<Organization, 'name'> | null
}): EquipmentLabel {
  return {
    qrUrl: inventoryItemQrUrl(params.item.item_id),
    assetCode: params.item.tracking_mode === 'serialized' ? 'Item' : 'Bulk item',
    itemName: params.item.name,
    organizationName: params.organization?.name ?? '',
  }
}

/** How many labels one print run may carry. */
export const MAX_LABELS_PER_PRINT = 200

export type LabelSelection =
  | { valid: true; unitIds: string[] }
  | { valid: false; message: string }

/**
 * Which units a print run covers.
 *
 * Purely a rendering decision — printing writes nothing — so the only limits
 * are that the selection is real and that the browser can lay it out.
 */
export function validateLabelSelection(params: {
  units: readonly InventoryUnit[]
  selectedIds: readonly string[]
}): LabelSelection {
  if (params.selectedIds.length === 0) {
    return { valid: false, message: 'Choose the equipment to print labels for.' }
  }

  const unique = [...new Set(params.selectedIds)]
  if (unique.length > MAX_LABELS_PER_PRINT) {
    return {
      valid: false,
      message: `Print at most ${MAX_LABELS_PER_PRINT} labels at a time.`,
    }
  }

  const known = new Set(params.units.map((unit) => unit.unit_id))
  for (const id of unique) {
    if (!known.has(id)) {
      return { valid: false, message: 'One of the chosen units no longer exists.' }
    }
  }

  return { valid: true, unitIds: unique }
}

/**
 * The labels a validated selection prints, in the order the units are listed.
 *
 * Indexed rather than searched per selected id: a full run is 200 units, and a
 * scan for each would be forty thousand comparisons to produce two hundred
 * stickers. Cheap either way at this size, but the map is no harder to read and
 * it stops the cost from being quadratic in the one place a user can choose the
 * size of the input.
 */
export function labelsForSelection(params: {
  units: readonly InventoryUnit[]
  unitIds: readonly string[]
  item: Pick<InventoryItem, 'name'> | null
  organization: Pick<Organization, 'name'> | null
}): EquipmentLabel[] {
  const byId = new Map(params.units.map((unit) => [unit.unit_id, unit]))

  return params.unitIds.flatMap((unitId) => {
    const unit = byId.get(unitId)
    return unit
      ? [equipmentLabel({ unit, item: params.item, organization: params.organization })]
      : []
  })
}

/**
 * The labels a print button would produce, or `null` if it must stay disabled.
 *
 * Computed while the selection dialog is still on screen and handed over whole,
 * so the sheet does not depend on that dialog still being mounted when the
 * browser's print dialog opens. See `EquipmentLabelPrinter` for why that
 * matters.
 */
export function printableLabels(params: {
  units: readonly InventoryUnit[]
  selectedIds: readonly string[]
  item: Pick<InventoryItem, 'name'> | null
  organization: Pick<Organization, 'name'> | null
}): EquipmentLabel[] | null {
  const selection = validateLabelSelection({
    units: params.units,
    selectedIds: params.selectedIds,
  })
  if (!selection.valid) return null

  return labelsForSelection({
    units: params.units,
    unitIds: selection.unitIds,
    item: params.item,
    organization: params.organization,
  })
}

/**
 * Which units a batch print offers first.
 *
 * Retired equipment keeps its identity and its label stays valid — a QR does
 * not stop working because something left the inventory — but a reprint run is
 * almost always about equipment still in use, so retired units are not selected
 * by default. They remain selectable for anyone reprinting an archive.
 */
export function isDefaultLabelSelection(unit: Pick<InventoryUnit, 'status'>): boolean {
  return unit.status !== 'retired'
}

/** Matches what somebody would read off the equipment in their hand. */
export function matchesLabelSearch(
  unit: Pick<InventoryUnit, 'asset_code' | 'storage_location'>,
  search: string,
): boolean {
  const needle = search.trim().toLowerCase()
  if (needle.length === 0) return true

  return unit.asset_code.toLowerCase().includes(needle)
    || unit.storage_location.toLowerCase().includes(needle)
}
