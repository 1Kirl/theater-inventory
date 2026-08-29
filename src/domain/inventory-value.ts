import { calculateEstimatedCost } from '@/domain/money'
import { trackingModeOf } from '@/domain/inventory'
import type { InventoryItem } from '@/types/inventory'

/**
 * What the active stock of one item would cost to replace.
 *
 * Deliberately not called book value or asset value. Nothing here is
 * depreciated, nothing records what was actually paid, and no purchase date
 * exists — it is the current replacement estimate multiplied by how many are
 * still in the inventory, which is a planning number and nothing more.
 *
 * Retired equipment is excluded. A retired unit is kept for its history and is
 * not something the program still has, so counting it would overstate what a
 * loss would cost to make good.
 */
export function activeQuantityOf(item: InventoryItem): number {
  // For a serialized item the parent's `quantity_total` already mirrors
  // `active_total`, but the units are the source and the mirror is the copy, so
  // the source is read where it exists.
  if (trackingModeOf(item) === 'serialized' && item.unit_counts) {
    return item.unit_counts.active_total
  }
  return item.quantity_total
}

/** Cents, or null when the item has no recorded unit cost. */
export function estimatedInventoryValue(item: InventoryItem): number | null {
  return calculateEstimatedCost(activeQuantityOf(item), item.unit_cost_cents)
}
