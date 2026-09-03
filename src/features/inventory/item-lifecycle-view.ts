import { itemStatusOf, offeredBulkTransitions, trackingModeOf } from '@/domain/inventory'
import { canEditTeamScopedRecord } from '@/domain/module-access'
import type { EffectiveRole } from '@/domain/effective-role'
import type { OrganizationMembership } from '@/types/organization'
import { UNIT_STATUS_LABELS } from '@/features/inventory/inventory-unit-view'
import type { LifecycleActionOption } from '@/features/inventory/unit-lifecycle-view'
import type { InventoryItem, UnitStatus } from '@/types/inventory'

/**
 * Presentation for a bulk item's own lifecycle.
 *
 * The item-level twin of `unit-lifecycle-view`, sharing its option shape so the
 * two dialogs render from the same kind of thing. Pure, so the decision about
 * which buttons appear can be tested without mounting anything.
 */

/**
 * Labels for a *group* rather than a piece.
 *
 * A unit says "Mark as In Use"; a box of twenty cables says "Sign Out", because
 * the thing being moved is the whole lot. The maintenance pair is here and is
 * not on the unit list, for the reason `OFFERED_BULK_ACTIONS` documents: a bulk
 * item carries no repair pointer, so moving it leaves nothing half-written.
 */
const BULK_ACTION_LABELS: Partial<Record<UnitStatus, Partial<Record<UnitStatus, string>>>> = {
  available: {
    in_use: 'Sign Out',
    in_maintenance: 'Send for Repair',
    lost: 'Mark Lost',
    retired: 'Retire',
  },
  in_use: {
    available: 'Return',
    in_maintenance: 'Send for Repair',
    lost: 'Mark Lost',
    retired: 'Retire',
  },
  in_maintenance: { available: 'Back from Repair', lost: 'Mark Lost', retired: 'Retire' },
  lost: { available: 'Mark as Found', retired: 'Retire' },
}

/**
 * The buttons a bulk item's page shows, in order.
 *
 * Driven by the domain's offered transitions rather than a second list, so a
 * button can never appear for a move the service would refuse.
 *
 * Condition is deliberately not consulted, unlike a unit's. A unit has one
 * condition and being unusable stops it going out; a bulk item's condition is a
 * spread across a quantity, and some of twenty cables being unusable says
 * nothing about whether the group can be signed out.
 */
export function itemLifecycleActions(
  item: Pick<InventoryItem, 'status'>,
): LifecycleActionOption[] {
  const from = itemStatusOf(item)

  return offeredBulkTransitions(from).map((to) => ({
    to,
    label: BULK_ACTION_LABELS[from]?.[to] ?? UNIT_STATUS_LABELS[to],
    tone: to === 'retired' || to === 'lost' ? 'outline' : 'default',
  }))
}

/** Why a bulk item offers nothing. */
export function noItemActionsReason(item: Pick<InventoryItem, 'status'>): string | null {
  if (itemStatusOf(item) === 'retired') {
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
