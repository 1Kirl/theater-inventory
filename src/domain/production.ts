import type { InventoryItem } from '@/types/inventory'
import type {
  ActionStatus,
  ActionType,
  ProductionRequirement,
  ProductionStatus,
} from '@/types/production'

/**
 * Requirement arithmetic, kept pure so the detail table, the action dialog, and
 * the action list all report the same numbers.
 */

export const PRODUCTION_STATUS_LABELS: Record<ProductionStatus, string> = {
  planning: 'Planning',
  active: 'Active',
  completed: 'Completed',
}

/** The four things a crew can actually do. Nothing else is an action. */
export const ACTION_TYPE_LABELS: Record<ActionType, string> = {
  buy: 'Buy',
  rent: 'Rent',
  build: 'Build',
  repair: 'Repair',
}

/**
 * Not an action type. A requirement covered by available stock needs no work,
 * and this label says so; no Action Item is written for it.
 */
export const ALREADY_AVAILABLE_LABEL = 'Already Available'

export const ACTION_STATUS_LABELS: Record<ActionStatus, string> = {
  todo: 'To do',
  in_progress: 'In progress',
  done: 'Done',
  cancelled: 'Cancelled',
}

/**
 * A requirement is either unmatched, or matched with real numbers.
 *
 * Availability is the linked item's `quantity_available` and nothing else. The
 * quantity currently in service is a separate indicator and is never subtracted
 * here: `quantity_available` is already what a person maintains as genuinely
 * available, so deducting it again would count the same equipment twice.
 */
export type RequirementAvailability =
  | { matched: false }
  | { matched: true; available: number; shortage: number; alreadyAvailable: boolean }

export function requirementAvailability(
  requirement: Pick<ProductionRequirement, 'inventory_item_id' | 'required_qty'>,
  items: readonly Pick<InventoryItem, 'item_id' | 'quantity_available'>[],
): RequirementAvailability {
  if (!requirement.inventory_item_id) return { matched: false }

  const item = items.find((entry) => entry.item_id === requirement.inventory_item_id)
  if (!item) return { matched: false }

  const available = item.quantity_available
  const shortage = Math.max(requirement.required_qty - available, 0)

  return { matched: true, available, shortage, alreadyAvailable: shortage === 0 }
}

export function shortageOf(requiredQty: number, available: number): number {
  return Math.max(requiredQty - available, 0)
}

/**
 * Whether an Action Item may exist for this requirement.
 *
 * Not Matched has no shortage to act on, and a shortage of zero needs no work.
 * Security Rules enforce the same two conditions at creation.
 */
export function canCreateActionItem(availability: RequirementAvailability): boolean {
  return availability.matched && availability.shortage > 0
}

/** The action quantity a new Action Item starts at. Editable afterwards. */
export function defaultActionQuantity(availability: RequirementAvailability): number {
  return availability.matched ? availability.shortage : 0
}

export type RequirementValidation = { valid: true } | { valid: false; message: string }

export function validateRequiredQuantity(requiredQty: number): RequirementValidation {
  if (!Number.isInteger(requiredQty) || requiredQty <= 0) {
    return { valid: false, message: 'Required quantity must be a whole number greater than zero.' }
  }
  return { valid: true }
}

export function validateActionQuantity(quantity: number): RequirementValidation {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    return { valid: false, message: 'Action quantity must be a whole number greater than zero.' }
  }
  return { valid: true }
}

export function isOpenAction(status: ActionStatus): boolean {
  return status === 'todo' || status === 'in_progress'
}

