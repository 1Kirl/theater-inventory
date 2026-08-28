import {
  collection, doc, getDocs, query, runTransaction, serverTimestamp, where,
  type DocumentReference,
} from 'firebase/firestore'
import { getFirebaseAuth, getFirebaseDb } from '@/lib/firebase'
import { COLLECTIONS } from '@/domain/organization-ids'
import { OrganizationError } from '@/domain/organization-errors'
import { canTransition, isOfferedTransition, isSerialized } from '@/domain/inventory'
import {
  isOperationallyAvailable, mirrorsOf, withStatusChanged, type ItemMirrors,
} from '@/domain/inventory-unit'
import { buildAssetEventDocument, eventTypeFor } from '@/domain/asset-event-payloads'
import { buildInventoryItemUpdate } from '@/domain/inventory-payloads'
import type { AssetEvent } from '@/types/asset-event'
import type { InventoryItem, InventoryUnit, RetirementReason, UnitStatus } from '@/types/inventory'

/**
 * Moving a piece of equipment through its life.
 *
 * One transaction per action, carrying three documents: the unit, its parent's
 * mirrors, and one history event. All or nothing — a unit that says Lost while
 * the item summary still counts it as available is worse than the action having
 * failed outright, and a history with gaps is worse than no history.
 *
 * The event ref is allocated before the transaction opens, for the reason
 * proven in Phase 11B: a contended transaction body runs again, and a ref
 * generated inside it would differ on the retry, appending a second event for
 * one action.
 */

const MAX_NOTE_LENGTH = 2000

export interface LifecycleAction {
  unit: InventoryUnit
  to: UnitStatus
  /** Required when taking equipment out; never inferred from the owning team. */
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
export function lifecycleRefusal(action: LifecycleAction): string | null {
  const { unit, to } = action

  if (unit.status === to) return 'That is already this unit\'s status.'

  if (!canTransition(unit.status, to)) {
    return `A unit cannot go from ${unit.status.replace('_', ' ')} to ${to.replace('_', ' ')}.`
  }

  if (!isOfferedTransition(unit.status, to)) {
    return 'That move is not something this version of the application can record.'
  }

  if (to === 'in_use') {
    // Availability is status and condition together: something unusable is on
    // the shelf but not fit to take out.
    if (!isOperationallyAvailable(unit)) {
      return 'This unit is unusable. Repair it before taking it out.'
    }
    if ((action.usingTeamId ?? '').trim().length === 0) {
      return 'Say which team is taking this unit.'
    }
  }

  if (to === 'retired' && !action.retirementReason) {
    return 'Say why this unit is being retired.'
  }

  if ((action.note?.trim().length ?? 0) > MAX_NOTE_LENGTH) {
    return `A note must be ${MAX_NOTE_LENGTH} characters or fewer.`
  }

  return null
}

/** The unit fields that describe a current loan, and only a current loan. */
function usageFieldsFor(action: LifecycleAction, now: () => unknown) {
  if (action.to !== 'in_use') return {}

  return {
    using_team_id: action.usingTeamId as string,
    ...(action.usingMemberUid ? { using_member_uid: action.usingMemberUid } : {}),
    checked_out_at: now(),
  }
}

function itemInputWithMirrors(item: InventoryItem, mirrors: ItemMirrors) {
  return {
    name: item.name,
    category: item.category,
    teamId: item.team_id,
    trackingMode: 'serialized' as const,
    unitCounts: mirrors.unit_counts,
    quantityTotal: mirrors.quantity_total,
    quantityAvailable: mirrors.quantity_available,
    conditionCounts: mirrors.condition_counts,
    location: item.location,
    lastInspectedAt: item.last_inspected_at ?? null,
    notes: item.notes,
  }
}

/**
 * Perform one lifecycle action.
 *
 * The unit is re-read inside the transaction rather than trusted from the page:
 * two people acting on the same piece of equipment at once must not both
 * compute the parent's counters from the same stale status.
 */
export async function performLifecycleAction(action: LifecycleAction): Promise<void> {
  const uid = requireUid()

  const refusal = lifecycleRefusal(action)
  if (refusal) throw new OrganizationError('invalid-lifecycle-action', refusal)

  const eventType = eventTypeFor(action.unit.status, action.to)
  if (!eventType) {
    throw new OrganizationError('invalid-lifecycle-action', 'That move has no history entry.')
  }

  const db = getFirebaseDb()
  const unitRef = doc(db, COLLECTIONS.inventoryUnits, action.unit.unit_id)
  const itemRef = doc(db, COLLECTIONS.inventoryItems, action.unit.inventory_item_id)
  // Allocated once, outside the transaction: a retry reuses it rather than
  // appending a second event for the same action.
  const eventRef = doc(collection(db, COLLECTIONS.assetEvents))

  await runTransaction(db, async (transaction) => {
    const unitSnapshot = await transaction.get(unitRef)
    const itemSnapshot = await transaction.get(itemRef)

    if (!unitSnapshot.exists()) {
      throw new OrganizationError('inventory-unit-not-found', 'That unit is gone.')
    }
    if (!itemSnapshot.exists()) {
      throw new OrganizationError('inventory-item-not-found', 'That inventory item is gone.')
    }

    const unit = unitSnapshot.data() as InventoryUnit
    const item = itemSnapshot.data() as InventoryItem

    if (!isSerialized(item)) {
      throw new OrganizationError(
        'invalid-lifecycle-action',
        'This item tracks a quantity rather than individual equipment.',
      )
    }

    // The action was chosen against the status the page was showing. If the
    // equipment has moved since — somebody else checked it in, or reported it
    // lost — then the button pressed is not the action that would happen, and
    // the history entry would name a move nobody made. Refuse and let the page
    // reload rather than quietly performing something else.
    if (unit.status !== action.unit.status) {
      throw new OrganizationError(
        'invalid-lifecycle-action',
        'Somebody else moved this unit while this page was open. Reload and try again.',
      )
    }

    // Re-checked against what is stored, not against the page's copy.
    const stale = lifecycleRefusal({ ...action, unit })
    if (stale) throw new OrganizationError('invalid-lifecycle-action', stale)

    // Whoever had it, before the unit stops recording it.
    const previousTeam = unit.using_team_id ?? null
    const previousMember = unit.using_member_uid ?? null

    transaction.set(unitRef, {
      unit_id: unit.unit_id,
      organization_id: unit.organization_id,
      inventory_item_id: unit.inventory_item_id,
      team_id: unit.team_id,
      asset_code: unit.asset_code,
      condition: unit.condition,
      status: action.to,
      storage_location: unit.storage_location,
      ...(action.to === 'retired' && action.retirementReason
        ? { retirement_reason: action.retirementReason }
        : {}),
      // Borrowing details describe a unit that is out. Checking it in, losing
      // it, or retiring it all end the loan, so they are dropped from the
      // current state — the event above keeps them.
      ...usageFieldsFor(action, serverTimestamp),
      // The event this status came from. Rules require it to change on every
      // transition and to name an event that describes exactly this move, which
      // is what makes a status change without history impossible.
      last_lifecycle_event_id: eventRef.id,
      ...(unit.last_known_location ? { last_known_location: unit.last_known_location } : {}),
      ...(unit.last_inspected_at ? { last_inspected_at: unit.last_inspected_at } : {}),
      ...(unit.notes ? { notes: unit.notes } : {}),
      created_by_uid: unit.created_by_uid,
      created_at: unit.created_at,
      updated_at: serverTimestamp(),
    })

    const next = withStatusChanged(mirrorsOf(item), {
      condition: unit.condition,
      from: unit.status,
      to: action.to,
    })

    transaction.set(itemRef, buildInventoryItemUpdate({
      itemId: item.item_id,
      organizationId: item.organization_id,
      createdByUid: item.created_by_uid,
      createdAt: item.created_at,
      now: serverTimestamp,
      input: itemInputWithMirrors(item, next),
    }))

    transaction.set(eventRef as DocumentReference, buildAssetEventDocument({
      eventId: eventRef.id,
      organizationId: unit.organization_id,
      inventoryItemId: unit.inventory_item_id,
      inventoryUnitId: unit.unit_id,
      uid,
      now: serverTimestamp,
      input: {
        eventType,
        fromStatus: unit.status,
        toStatus: action.to,
        // Taking it out records the new borrower; every other move records who
        // had it, which is about to disappear from the unit.
        usingTeamId: action.to === 'in_use' ? (action.usingTeamId ?? null) : previousTeam,
        usingMemberUid: action.to === 'in_use'
          ? (action.usingMemberUid ?? null)
          : previousMember,
        retirementReason: action.retirementReason ?? null,
        note: action.note,
      },
    }))
  })
}

/**
 * A unit's history, newest first.
 *
 * Two equality filters, which single-field indexes already serve — the same
 * shape every other query in this project uses, and the reason ordering is done
 * here rather than in Firestore. A unit accumulates a handful of events over
 * its life, so sorting them in the client costs nothing and keeps
 * `firestore.indexes.json` empty.
 */
export async function listUnitHistory(params: {
  organizationId: string
  unitId: string
}): Promise<AssetEvent[]> {
  const snapshot = await getDocs(
    query(
      collection(getFirebaseDb(), COLLECTIONS.assetEvents),
      where('organization_id', '==', params.organizationId),
      where('inventory_unit_id', '==', params.unitId),
    ),
  )

  return snapshot.docs
    .map((entry) => entry.data() as AssetEvent)
    .sort((left, right) => (right.occurred_at?.toMillis() ?? 0) - (left.occurred_at?.toMillis() ?? 0))
}
