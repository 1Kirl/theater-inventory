import { itemStatusOf, trackingModeOf } from '@/domain/inventory'
import { canEditTeamScopedRecord } from '@/domain/module-access'
import type { EffectiveRole } from '@/domain/effective-role'
import type { OrganizationMembership } from '@/types/organization'
import { lifecycleActions } from '@/features/inventory/unit-lifecycle-view'
import type { LifecycleActionOption } from '@/features/inventory/unit-lifecycle-view'
import type { InventoryItem } from '@/types/inventory'

/**
 * Presentation for a bulk item's own lifecycle.
 *
 * The item-level twin of `unit-lifecycle-view`, sharing its option shape so the
 * two dialogs render from the same kind of thing. Pure, so the decision about
 * which buttons appear can be tested without mounting anything.
 */

/**
 * The buttons a bulk item's page shows, in order.
 *
 * Delegates to `lifecycleActions`, so a bulk item is offered exactly what a
 * unit is offered, under exactly the same labels. An earlier version of this
 * had a vocabulary of its own — Sign Out, Send for Repair — which made the same
 * operation read as two different features depending on how the equipment
 * happened to be counted, and put a maintenance move on a page that has no
 * business making one.
 *
 * `condition` is passed as `good` rather than read from the item. A unit has
 * one condition and being unusable stops it going out; a bulk item's condition
 * is a spread across a quantity, and some of twenty cables being unusable says
 * nothing about whether the group can be taken out.
 */
export function itemLifecycleActions(
  item: Pick<InventoryItem, 'status'>,
): LifecycleActionOption[] {
  return lifecycleActions({ status: itemStatusOf(item), condition: 'good' })
}

/** Why a bulk item offers nothing. The unit's wording, for the same states. */
export function noItemActionsReason(item: Pick<InventoryItem, 'status'>): string | null {
  const status = itemStatusOf(item)

  if (status === 'in_maintenance') {
    // Inventory offers nothing here on purpose: the repair record is what moves
    // it back, exactly as it is for a unit.
    return 'This item is away for repair. Its status follows the maintenance record.'
  }
  if (status === 'retired') {
    return 'This item has been retired. Its history stays, but it is out of the inventory.'
  }
  return null
}

export interface ItemLifecyclePanel {
  /** False hides the section entirely: this person cannot move this item. */
  visible: boolean
  actions: LifecycleActionOption[]
  /** Shown when the section is visible but empty. */
  reason: string | null
}

/**
 * Whether the item page shows lifecycle controls at all, and which.
 *
 * Permission first, through `canEditTeamScopedRecord` — the same function the
 * unit panel and Security Rules agree on, rather than a second rule that could
 * drift from them.
 *
 * Serialized items get nothing. Their units each carry a status of their own,
 * and an item-level control beside them would be offering a move the item
 * cannot make: Rules refuse `status` on a serialized item outright.
 */
export function itemLifecyclePanel(params: {
  item: Pick<InventoryItem, 'status' | 'team_id' | 'tracking_mode'>
  role: EffectiveRole | null
  membership: Pick<OrganizationMembership, 'team_ids' | 'permissions'> | null
}): ItemLifecyclePanel {
  if (trackingModeOf(params.item) !== 'bulk') {
    return { visible: false, actions: [], reason: null }
  }

  const allowed = canEditTeamScopedRecord(
    params.role, params.membership, 'inventory', params.item.team_id,
  )
  if (!allowed) return { visible: false, actions: [], reason: null }

  const actions = itemLifecycleActions(params.item)
  return { visible: true, actions, reason: noItemActionsReason(params.item) }
}
