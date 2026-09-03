import { doc, runTransaction, serverTimestamp, collection, type DocumentReference } from 'firebase/firestore'
import { getFirebaseAuth, getFirebaseDb } from '@/lib/firebase'
import { COLLECTIONS } from '@/domain/organization-ids'
import { OrganizationError } from '@/domain/organization-errors'
import {
  canTransition, isOfferedBulkTransition, itemStatusOf, tracksItemStatus,
} from '@/domain/inventory'
import { buildItemAssetEventDocument, itemEventTypeFor } from '@/domain/asset-event-payloads'
import { buildInventoryItemUpdate } from '@/domain/inventory-payloads'
import type { InventoryItem, RetirementReason, UnitStatus } from '@/types/inventory'

/**
 * Moving a bulk item through its life.
 *
 * The item-level twin of `unit-lifecycle-service`, and deliberately the same
 * shape: one transaction carrying the item and one history event, all or
 * nothing. A bulk item that says Retired with no event explaining it is worse
 * than the action having failed.
 *
 * Two things it does *not* do, both on purpose:
 *
 * - It never touches `quantity_total`, `quantity_available`, or
 *   `condition_counts`. Lifecycle and quantity are different questions about a
 *   bulk item — how the group is doing, and how much of it there is — and this
 *   answers only the first. The whole document is rewritten, so those fields
 *   are carried through verbatim rather than left out.
 * - It never touches maintenance records. A bulk repair has always been a
 *   quantity on `maintenance_records` and has never written to the item; moving
 *   the group to `in_maintenance` does not change how many are recorded as out,
 *   and returning it does not close anybody's repair.
 *
 * The event ref is allocated before the transaction opens, for the reason
 * proven in Phase 11B: a contended transaction body runs again, and a ref
 * generated inside it would differ on the retry, appending a second event for
 * one action.
 */

const MAX_NOTE_LENGTH = 2000

export interface ItemLifecycleAction {
  item: InventoryItem
  to: UnitStatus
  /** Required when the group goes out; never inferred from the owning team. */
  usingTeamId?: string | null
  usingMemberUid?: string | null
  retirementReason?: RetirementReason | null
  note?: string | undefined
}

function requireUid(): string {
  const user = getFirebaseAuth().currentUser
  if (!user) throw new OrganizationError('not-signed-in', 'You are not signed in.')
  return user.uid
}

/**
 * Everything that must hold before a move is attempted.
 *
 * Exported because the same answer decides whether a button is offered, and a
 * button that appears and then fails is worse than one that never appeared.
 */
export function itemLifecycleRefusal(action: ItemLifecycleAction): string | null {
  const { item, to } = action
  const from = itemStatusOf(item)

  if (!tracksItemStatus(item)) {
    return 'This item is tracked as individual equipment. Move its units instead.'
  }
  if (from === to) return 'That is already this item’s status.'
  if (!canTransition(from, to)) return 'That is not a move this item can make.'
  if (!isOfferedBulkTransition(from, to)) return 'That move is not offered here.'
  if (to === 'retired' && !action.retirementReason) {
    return 'Choose why this item is being retired.'
  }
  if (to !== 'retired' && action.retirementReason) {
    return 'A retirement reason belongs to a retirement.'
  }
  if (to === 'in_use' && !action.usingTeamId) {
    return 'Choose which team is taking it.'
  }
  if (to !== 'in_use' && action.usingTeamId) {
    return 'Only equipment going out records a borrowing team.'
  }
  if ((action.note?.length ?? 0) > MAX_NOTE_LENGTH) {
    return `Keep the note under ${MAX_NOTE_LENGTH} characters.`
  }

  return null
}

/**
 * Apply the move.
 *
 * The item is re-read inside the transaction and re-checked there. The copy the
 * page is holding was loaded when it rendered, and in between somebody else may
 * have retired the group; deciding from the stale copy is how two people
 * produce two events for one move.
 */
export async function changeItemStatus(action: ItemLifecycleAction): Promise<void> {
  const uid = requireUid()

  const upfront = itemLifecycleRefusal(action)
  if (upfront) throw new OrganizationError('invalid-lifecycle-action', upfront)

  const db = getFirebaseDb()
  const itemRef = doc(db, COLLECTIONS.inventoryItems, action.item.item_id)
  const eventRef = doc(collection(db, COLLECTIONS.assetEvents))

  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(itemRef)
    if (!snapshot.exists()) {
      throw new OrganizationError('inventory-item-not-found', 'That inventory item is gone.')
    }

    const item = snapshot.data() as InventoryItem
    const from = itemStatusOf(item)

    // The check that matters, on the server's copy rather than the page's.
    const stale = itemLifecycleRefusal({ ...action, item })
    if (stale) throw new OrganizationError('invalid-lifecycle-action', stale)

    const eventType = itemEventTypeFor(from, action.to)
    if (!eventType) throw new OrganizationError('invalid-lifecycle-action', 'That move has no event.')

    // Built by the shared payload builder rather than by hand. An item write
    // replaces the whole document, so a field this code forgets is a field the
    // item loses — quantities and condition counts included, none of which this
    // operation has any business changing.
    transaction.set(itemRef, buildInventoryItemUpdate({
      itemId: item.item_id,
      organizationId: item.organization_id,
      createdByUid: item.created_by_uid,
      createdAt: item.created_at,
      now: serverTimestamp,
      input: {
        name: item.name,
        category: item.category,
        teamId: item.team_id,
        trackingMode: 'bulk',
        quantityTotal: item.quantity_total,
        quantityAvailable: item.quantity_available,
        conditionCounts: item.condition_counts,
        location: item.location,
        unitCostCents: item.unit_cost_cents ?? null,
        lastInspectedAt: item.last_inspected_at ?? null,
        notes: item.notes,
        status: action.to,
        retirementReason: action.retirementReason ?? undefined,
        // The event this status came from. Rules require it to change on every
        // transition and to name an event describing exactly this move, which
        // is what makes a status change without history impossible.
        lastLifecycleEventId: eventRef.id,
      },
    }))

    transaction.set(eventRef as DocumentReference, buildItemAssetEventDocument({
      eventId: eventRef.id,
      organizationId: item.organization_id,
      inventoryItemId: item.item_id,
      uid,
      now: serverTimestamp,
      input: {
        eventType,
        fromStatus: from,
        toStatus: action.to,
        usingTeamId: action.usingTeamId ?? null,
        usingMemberUid: action.usingMemberUid ?? null,
        retirementReason: action.retirementReason ?? null,
        note: action.note,
      },
    }))
  })
}
