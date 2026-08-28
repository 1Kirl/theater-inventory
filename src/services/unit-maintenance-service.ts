import {
  collection, doc, runTransaction, serverTimestamp,
  type DocumentReference,
} from 'firebase/firestore'
import { getFirebaseAuth, getFirebaseDb } from '@/lib/firebase'
import { COLLECTIONS } from '@/domain/organization-ids'
import { OrganizationError } from '@/domain/organization-errors'
import { isSerialized } from '@/domain/inventory'
import { mirrorsOf, withStatusChanged, type ItemMirrors } from '@/domain/inventory-unit'
import { buildBatchAssetEventDocument } from '@/domain/asset-event-payloads'
import { buildInventoryItemUpdate } from '@/domain/inventory-payloads'
import {
  buildMaintenanceDocument, buildMaintenanceUpdate, type MaintenanceInput,
} from '@/domain/maintenance-payloads'
import {
  MAX_UNITS_PER_MAINTENANCE, canPlanForMaintenance, canSendToMaintenance,
  canStartPlanAt, describeStartConflicts, isPlannedMaintenance, isSerializedMaintenance,
  planIneligibleReason, startConflicts, validateSerializedStatusChange,
} from '@/domain/unit-maintenance'
import type { InventoryItem, InventoryUnit } from '@/types/inventory'
import type { MaintenanceRecord, MaintenanceStatus } from '@/types/maintenance'

/**
 * Sending individually tracked equipment for repair, and getting it back.
 *
 * One transaction carries the whole batch: every unit, the parent's counts, the
 * maintenance record, and a single shared lifecycle event. All or nothing —
 * four of five clamps at the shop under a record claiming five would be worse
 * than the send having failed.
 *
 * The event is shared rather than one per unit because Security Rules charge
 * per distinct document read. A per-unit event ran out of access calls at six
 * units; sharing one keeps the cost flat, and two hundred commit fine. Each
 * unit still proves its own membership in that event, so no unit can move
 * without history.
 */

function requireUid(): string {
  const user = getFirebaseAuth().currentUser
  if (!user) throw new OrganizationError('not-signed-in', 'You are not signed in.')
  return user.uid
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

/** The unit document a send or return leaves behind. */
function unitAfter(params: {
  unit: InventoryUnit
  status: 'in_maintenance' | 'available'
  eventId: string
  recordId: string
  history: readonly string[]
}) {
  const goingOut = params.status === 'in_maintenance'

  return {
    unit_id: params.unit.unit_id,
    organization_id: params.unit.organization_id,
    inventory_item_id: params.unit.inventory_item_id,
    team_id: params.unit.team_id,
    asset_code: params.unit.asset_code,
    condition: params.unit.condition,
    status: params.status,
    storage_location: params.unit.storage_location,
    last_lifecycle_event_id: params.eventId,
    // Current state while it is away, gone once it is back.
    ...(goingOut ? { current_maintenance_record_id: params.recordId } : {}),
    // The visit is recorded when the equipment leaves and stays afterwards.
    ...(params.history.length > 0 ? { maintenance_record_ids: [...params.history] } : {}),
    // On the way out the plan is over — it has become this repair — so no
    // pointer is carried. On the way back there is nothing to carry either,
    // because a unit at the shop cannot be planned into another repair.
    ...(params.unit.last_known_location
      ? { last_known_location: params.unit.last_known_location }
      : {}),
    ...(params.unit.last_inspected_at ? { last_inspected_at: params.unit.last_inspected_at } : {}),
    ...(params.unit.notes ? { notes: params.unit.notes } : {}),
    created_by_uid: params.unit.created_by_uid,
    created_at: params.unit.created_at,
    updated_at: serverTimestamp(),
  }
}

/** A unit with only its planning pointer changed. Nothing physical moves. */
function unitWithPlan(unit: InventoryUnit, planId: string | null) {
  return {
    unit_id: unit.unit_id,
    organization_id: unit.organization_id,
    inventory_item_id: unit.inventory_item_id,
    team_id: unit.team_id,
    asset_code: unit.asset_code,
    condition: unit.condition,
    status: unit.status,
    storage_location: unit.storage_location,
    ...(unit.retirement_reason ? { retirement_reason: unit.retirement_reason } : {}),
    ...(unit.using_team_id ? { using_team_id: unit.using_team_id } : {}),
    ...(unit.using_member_uid ? { using_member_uid: unit.using_member_uid } : {}),
    ...(unit.checked_out_at ? { checked_out_at: unit.checked_out_at } : {}),
    ...(unit.last_lifecycle_event_id
      ? { last_lifecycle_event_id: unit.last_lifecycle_event_id }
      : {}),
    ...(unit.current_maintenance_record_id
      ? { current_maintenance_record_id: unit.current_maintenance_record_id }
      : {}),
    ...(unit.maintenance_record_ids && unit.maintenance_record_ids.length > 0
      ? { maintenance_record_ids: [...unit.maintenance_record_ids] }
      : {}),
    ...(planId ? { planned_maintenance_record_id: planId } : {}),
    ...(unit.last_known_location ? { last_known_location: unit.last_known_location } : {}),
    ...(unit.last_inspected_at ? { last_inspected_at: unit.last_inspected_at } : {}),
    ...(unit.notes ? { notes: unit.notes } : {}),
    created_by_uid: unit.created_by_uid,
    created_at: unit.created_at,
    updated_at: serverTimestamp(),
  }
}

/**
 * Plan a repair.
 *
 * Nothing physical happens. The equipment stays available, stays usable, and
 * keeps whatever lifecycle status it has; all that changes is a pointer on each
 * unit saying which repair it is intended for, so the unit page can say so and
 * link to the plan. Availability is checked again when the repair starts.
 */
export async function planUnitsForMaintenance(params: {
  item: InventoryItem
  units: readonly InventoryUnit[]
  input: Omit<MaintenanceInput, 'trackingMode' | 'unitIds' | 'quantitySent' | 'status'>
}): Promise<{ maintenanceId: string }> {
  const uid = requireUid()

  if (!isSerialized(params.item)) {
    throw new OrganizationError(
      'invalid-maintenance-record',
      'This item tracks a quantity rather than individual pieces.',
    )
  }
  if (params.units.length === 0) {
    throw new OrganizationError('invalid-maintenance-record', 'Choose the equipment to plan for.')
  }
  if (params.units.length > MAX_UNITS_PER_MAINTENANCE) {
    throw new OrganizationError(
      'invalid-maintenance-record',
      `Plan at most ${MAX_UNITS_PER_MAINTENANCE} pieces at a time.`,
    )
  }

  const db = getFirebaseDb()
  const recordRef = doc(collection(db, COLLECTIONS.maintenanceRecords))
  const unitRefs = params.units.map(
    (unit) => doc(db, COLLECTIONS.inventoryUnits, unit.unit_id),
  )

  await runTransaction(db, async (transaction) => {
    const unitSnapshots = await Promise.all(unitRefs.map((ref) => transaction.get(ref)))

    const units = unitSnapshots.map((snapshot, index) => {
      if (!snapshot.exists()) {
        throw new OrganizationError(
          'inventory-unit-not-found',
          `${params.units[index]?.asset_code ?? 'A unit'} is gone.`,
        )
      }
      return snapshot.data() as InventoryUnit
    })

    for (const unit of units) {
      if (!canPlanForMaintenance(unit)) {
        throw new OrganizationError(
          'invalid-maintenance-record',
          `${unit.asset_code} cannot be planned: ${
            (planIneligibleReason(unit) ?? '').toLowerCase()}.`,
        )
      }
    }

    const unitIds = units.map((unit) => unit.unit_id)

    transaction.set(recordRef, buildMaintenanceDocument({
      maintenanceId: recordRef.id,
      organizationId: params.item.organization_id,
      itemId: params.item.item_id,
      teamId: params.item.team_id,
      uid,
      now: serverTimestamp,
      input: {
        ...params.input,
        trackingMode: 'serialized',
        unitIds,
        quantitySent: unitIds.length,
        status: 'planned',
      },
    }))

    // Only the pointer. No status change, no parent counts, no history, no
    // lifecycle event — none of that has happened.
    units.forEach((unit, index) => {
      transaction.set(unitRefs[index] as DocumentReference, unitWithPlan(unit, recordRef.id))
    })
  })

  return { maintenanceId: recordRef.id }
}

/**
 * Change which equipment a plan covers.
 *
 * Only while it is still a plan. Units dropped from it lose their pointer, units
 * added take one, and nothing about any of them moves.
 */
export async function updateMaintenancePlan(params: {
  record: MaintenanceRecord
  units: readonly InventoryUnit[]
  input: Omit<MaintenanceInput, 'trackingMode' | 'unitIds' | 'quantitySent' | 'status'>
}): Promise<void> {
  requireUid()

  if (!isPlannedMaintenance(params.record)) {
    throw new OrganizationError(
      'invalid-maintenance-record',
      'The equipment on a repair is settled once it has started.',
    )
  }
  if (params.units.length === 0) {
    throw new OrganizationError('invalid-maintenance-record', 'Choose the equipment to plan for.')
  }
  if (params.units.length > MAX_UNITS_PER_MAINTENANCE) {
    throw new OrganizationError(
      'invalid-maintenance-record',
      `Plan at most ${MAX_UNITS_PER_MAINTENANCE} pieces at a time.`,
    )
  }

  const db = getFirebaseDb()
  const recordRef = doc(db, COLLECTIONS.maintenanceRecords, params.record.maintenance_id)
  const nextIds = params.units.map((unit) => unit.unit_id)
  const previousIds = params.record.unit_ids ?? []
  const droppedIds = previousIds.filter((id) => !nextIds.includes(id))

  const addedRefs = params.units
    .filter((unit) => !previousIds.includes(unit.unit_id))
    .map((unit) => doc(db, COLLECTIONS.inventoryUnits, unit.unit_id))
  const droppedRefs = droppedIds.map((id) => doc(db, COLLECTIONS.inventoryUnits, id))

  await runTransaction(db, async (transaction) => {
    const recordSnapshot = await transaction.get(recordRef)
    const addedSnapshots = await Promise.all(addedRefs.map((ref) => transaction.get(ref)))
    const droppedSnapshots = await Promise.all(droppedRefs.map((ref) => transaction.get(ref)))

    if (!recordSnapshot.exists()) {
      throw new OrganizationError('maintenance-record-not-found', 'That plan is gone.')
    }
    const record = recordSnapshot.data() as MaintenanceRecord
    if (!isPlannedMaintenance(record)) {
      throw new OrganizationError(
        'invalid-maintenance-record',
        'This repair has already started. Its equipment can no longer be changed.',
      )
    }

    transaction.set(recordRef, buildMaintenanceUpdate({
      maintenanceId: record.maintenance_id,
      organizationId: record.organization_id,
      itemId: record.item_id,
      teamId: record.team_id,
      createdByUid: record.created_by_uid,
      createdAt: record.created_at,
      now: serverTimestamp,
      input: {
        ...params.input,
        trackingMode: 'serialized',
        unitIds: nextIds,
        quantitySent: nextIds.length,
        status: 'planned',
      },
    }))

    addedSnapshots.forEach((snapshot, index) => {
      if (!snapshot.exists()) return
      const unit = snapshot.data() as InventoryUnit

      if (!canPlanForMaintenance(unit, record.maintenance_id)) {
        throw new OrganizationError(
          'invalid-maintenance-record',
          `${unit.asset_code} cannot be planned: ${
            (planIneligibleReason(unit, record.maintenance_id) ?? '').toLowerCase()}.`,
        )
      }
      transaction.set(addedRefs[index] as DocumentReference,
        unitWithPlan(unit, record.maintenance_id))
    })

    droppedSnapshots.forEach((snapshot, index) => {
      if (!snapshot.exists()) return
      transaction.set(droppedRefs[index] as DocumentReference,
        unitWithPlan(snapshot.data() as InventoryUnit, null))
    })
  })
}

/**
 * Call off a plan.
 *
 * The equipment never went anywhere, so nothing comes back: the pointers go and
 * that is all. This is a different operation from cancelling a repair that has
 * started, which does have equipment to return.
 */
export async function cancelMaintenancePlan(params: {
  record: MaintenanceRecord
  input: Omit<MaintenanceInput, 'trackingMode' | 'unitIds' | 'quantitySent' | 'status'>
}): Promise<void> {
  requireUid()

  if (!isPlannedMaintenance(params.record)) {
    throw new OrganizationError(
      'invalid-maintenance-record',
      'This repair has started. Cancelling it returns the equipment.',
    )
  }

  const db = getFirebaseDb()
  const recordRef = doc(db, COLLECTIONS.maintenanceRecords, params.record.maintenance_id)
  const unitIds = params.record.unit_ids ?? []
  const unitRefs = unitIds.map((id) => doc(db, COLLECTIONS.inventoryUnits, id))

  await runTransaction(db, async (transaction) => {
    const recordSnapshot = await transaction.get(recordRef)
    const unitSnapshots = await Promise.all(unitRefs.map((ref) => transaction.get(ref)))

    if (!recordSnapshot.exists()) {
      throw new OrganizationError('maintenance-record-not-found', 'That plan is gone.')
    }
    const record = recordSnapshot.data() as MaintenanceRecord
    if (!isPlannedMaintenance(record)) {
      throw new OrganizationError(
        'invalid-maintenance-record',
        'This repair has started. Cancelling it returns the equipment.',
      )
    }

    transaction.set(recordRef, buildMaintenanceUpdate({
      maintenanceId: record.maintenance_id,
      organizationId: record.organization_id,
      itemId: record.item_id,
      teamId: record.team_id,
      createdByUid: record.created_by_uid,
      createdAt: record.created_at,
      now: serverTimestamp,
      input: {
        ...params.input,
        trackingMode: 'serialized',
        unitIds,
        quantitySent: unitIds.length,
        status: 'cancelled',
      },
    }))

    unitSnapshots.forEach((snapshot, index) => {
      if (!snapshot.exists()) return
      transaction.set(unitRefs[index] as DocumentReference,
        unitWithPlan(snapshot.data() as InventoryUnit, null))
    })
  })
}

/**
 * Send a batch of units for repair.
 *
 * Every unit is re-read inside the transaction: a page can be minutes old, and
 * a clamp somebody else checked out in the meantime must not be sent from a
 * stale screen.
 */
export async function sendUnitsToMaintenance(params: {
  item: InventoryItem
  units: readonly InventoryUnit[]
  /**
   * Where the repair already is. Defaults to `sent`, which is the common case;
   * a record entered days later may already be in service or ready.
   */
  status?: MaintenanceStatus
  input: Omit<MaintenanceInput, 'trackingMode' | 'unitIds' | 'quantitySent' | 'status'>
}): Promise<{ maintenanceId: string }> {
  const uid = requireUid()
  const status = params.status ?? 'sent'

  // This is the path that takes the equipment. Planning one instead goes
  // through `planUnitsForMaintenance`, which moves nothing.
  if (!canStartPlanAt(status)) {
    throw new OrganizationError(
      'invalid-maintenance-record',
      'A repair that takes the equipment is recorded as sent, in service, or ready. '
      + 'To plan one for later, create it as planned instead.',
    )
  }

  if (!isSerialized(params.item)) {
    throw new OrganizationError(
      'invalid-maintenance-record',
      'This item tracks a quantity rather than individual pieces.',
    )
  }
  if (params.units.length === 0) {
    throw new OrganizationError('invalid-maintenance-record', 'Choose the equipment to send.')
  }
  if (params.units.length > MAX_UNITS_PER_MAINTENANCE) {
    throw new OrganizationError(
      'invalid-maintenance-record',
      `Send at most ${MAX_UNITS_PER_MAINTENANCE} pieces at a time.`,
    )
  }

  const db = getFirebaseDb()
  // Allocated before the transaction opens: a contended body runs again, and
  // ids generated inside it would write a second record on the retry.
  const recordRef = doc(collection(db, COLLECTIONS.maintenanceRecords))
  const eventRef = doc(collection(db, COLLECTIONS.assetEvents))
  const itemRef = doc(db, COLLECTIONS.inventoryItems, params.item.item_id)
  const unitRefs = params.units.map(
    (unit) => doc(db, COLLECTIONS.inventoryUnits, unit.unit_id),
  )

  await runTransaction(db, async (transaction) => {
    const itemSnapshot = await transaction.get(itemRef)
    const unitSnapshots = await Promise.all(unitRefs.map((ref) => transaction.get(ref)))

    if (!itemSnapshot.exists()) {
      throw new OrganizationError('inventory-item-not-found', 'That inventory item is gone.')
    }
    const item = itemSnapshot.data() as InventoryItem

    const units = unitSnapshots.map((snapshot, index) => {
      if (!snapshot.exists()) {
        throw new OrganizationError(
          'inventory-unit-not-found',
          `${params.units[index]?.asset_code ?? 'A unit'} is gone.`,
        )
      }
      return snapshot.data() as InventoryUnit
    })

    for (const unit of units) {
      if (!canSendToMaintenance(unit)) {
        throw new OrganizationError(
          'invalid-maintenance-record',
          `${unit.asset_code} is no longer available to send. Reload and try again.`,
        )
      }
    }

    const unitIds = units.map((unit) => unit.unit_id)

    // Whichever stage the repair is recorded at, the equipment has gone. That
    // is the only thing the units know about it.
    transaction.set(recordRef, buildMaintenanceDocument({
      maintenanceId: recordRef.id,
      organizationId: item.organization_id,
      itemId: item.item_id,
      teamId: item.team_id,
      uid,
      now: serverTimestamp,
      input: {
        ...params.input,
        trackingMode: 'serialized',
        unitIds,
        quantitySent: unitIds.length,
        status,
      },
    }))

    units.forEach((unit, index) => {
      transaction.set(unitRefs[index] as DocumentReference, unitAfter({
        unit,
        status: 'in_maintenance',
        eventId: eventRef.id,
        recordId: recordRef.id,
        history: [...(unit.maintenance_record_ids ?? []), recordRef.id],
      }))
    })

    const next = units.reduce(
      (mirrors, unit) => withStatusChanged(mirrors, {
        condition: unit.condition, from: 'available', to: 'in_maintenance',
      }),
      mirrorsOf(item),
    )

    transaction.set(itemRef, buildInventoryItemUpdate({
      itemId: item.item_id,
      organizationId: item.organization_id,
      createdByUid: item.created_by_uid,
      createdAt: item.created_at,
      now: serverTimestamp,
      input: itemInputWithMirrors(item, next),
    }))

    transaction.set(eventRef, buildBatchAssetEventDocument({
      eventId: eventRef.id,
      organizationId: item.organization_id,
      inventoryItemId: item.item_id,
      inventoryUnitIds: unitIds,
      maintenanceRecordId: recordRef.id,
      uid,
      now: serverTimestamp,
      input: { eventType: 'sent_to_maintenance' },
    }))
  })

  return { maintenanceId: recordRef.id }
}

/**
 * Start a planned repair.
 *
 * The one moment the plan and the equipment meet. Every unit is re-read and must
 * be on the shelf right now — a plan reserves nothing, so a microphone somebody
 * borrowed in the meantime is a real obstacle rather than an impossibility, and
 * the conflict is reported by name.
 *
 * From there it is the ordinary start: the units move, the parent counts move,
 * each unit records the visit, the planning pointer goes, and one shared event
 * is written. All or nothing.
 */
export async function startPlannedMaintenance(params: {
  record: MaintenanceRecord
  /** Where the repair has actually reached, which may be past `sent`. */
  status?: MaintenanceStatus
  input: Omit<MaintenanceInput, 'trackingMode' | 'unitIds' | 'quantitySent' | 'status'>
}): Promise<void> {
  const uid = requireUid()
  const status = params.status ?? 'sent'

  if (!isPlannedMaintenance(params.record)) {
    throw new OrganizationError(
      'invalid-maintenance-record',
      'This repair has already started.',
    )
  }
  if (!canStartPlanAt(status)) {
    throw new OrganizationError(
      'invalid-maintenance-record',
      'A plan starts as sent, in service, or ready.',
    )
  }

  const db = getFirebaseDb()
  const recordRef = doc(db, COLLECTIONS.maintenanceRecords, params.record.maintenance_id)
  const itemRef = doc(db, COLLECTIONS.inventoryItems, params.record.item_id)
  const eventRef = doc(collection(db, COLLECTIONS.assetEvents))
  const unitIds = params.record.unit_ids ?? []
  const unitRefs = unitIds.map((id) => doc(db, COLLECTIONS.inventoryUnits, id))

  await runTransaction(db, async (transaction) => {
    const recordSnapshot = await transaction.get(recordRef)
    const itemSnapshot = await transaction.get(itemRef)
    const unitSnapshots = await Promise.all(unitRefs.map((ref) => transaction.get(ref)))

    if (!recordSnapshot.exists()) {
      throw new OrganizationError('maintenance-record-not-found', 'That plan is gone.')
    }
    if (!itemSnapshot.exists()) {
      throw new OrganizationError('inventory-item-not-found', 'That inventory item is gone.')
    }

    const record = recordSnapshot.data() as MaintenanceRecord
    const item = itemSnapshot.data() as InventoryItem

    if (!isPlannedMaintenance(record)) {
      throw new OrganizationError(
        'invalid-maintenance-record',
        'Somebody else started this repair while this page was open. Reload and try again.',
      )
    }

    const units = unitSnapshots.map((snapshot, index) => {
      if (!snapshot.exists()) {
        throw new OrganizationError(
          'inventory-unit-not-found',
          `A unit on this plan is gone (${unitIds[index] ?? 'unknown'}).`,
        )
      }
      return snapshot.data() as InventoryUnit
    })

    // Checked here rather than held in reserve, which is what let the equipment
    // stay usable while the plan waited.
    const conflicts = startConflicts(units)
    if (conflicts.length > 0) {
      throw new OrganizationError(
        'invalid-maintenance-record',
        describeStartConflicts(conflicts),
      )
    }

    transaction.set(recordRef, buildMaintenanceUpdate({
      maintenanceId: record.maintenance_id,
      organizationId: record.organization_id,
      itemId: record.item_id,
      teamId: record.team_id,
      createdByUid: record.created_by_uid,
      createdAt: record.created_at,
      now: serverTimestamp,
      input: {
        ...params.input,
        trackingMode: 'serialized',
        unitIds,
        quantitySent: unitIds.length,
        status,
      },
    }))

    units.forEach((unit, index) => {
      transaction.set(unitRefs[index] as DocumentReference, unitAfter({
        unit,
        status: 'in_maintenance',
        eventId: eventRef.id,
        recordId: record.maintenance_id,
        history: [...(unit.maintenance_record_ids ?? []), record.maintenance_id],
      }))
    })

    const next = units.reduce(
      (mirrors, unit) => withStatusChanged(mirrors, {
        condition: unit.condition, from: 'available', to: 'in_maintenance',
      }),
      mirrorsOf(item),
    )

    transaction.set(itemRef, buildInventoryItemUpdate({
      itemId: item.item_id,
      organizationId: item.organization_id,
      createdByUid: item.created_by_uid,
      createdAt: item.created_at,
      now: serverTimestamp,
      input: itemInputWithMirrors(item, next),
    }))

    transaction.set(eventRef, buildBatchAssetEventDocument({
      eventId: eventRef.id,
      organizationId: record.organization_id,
      inventoryItemId: record.item_id,
      inventoryUnitIds: unitIds,
      maintenanceRecordId: record.maintenance_id,
      uid,
      now: serverTimestamp,
      input: { eventType: 'sent_to_maintenance' },
    }))
  })
}

/**
 * Move a serialized repair along, or close it.
 *
 * Sent to in service to ready is paperwork about equipment that has not moved,
 * so it writes the record and nothing else. Returning or cancelling brings the
 * whole batch home at once — Phase 11D has no partial return, because a record
 * that is half returned cannot say which half.
 */
export async function updateSerializedMaintenance(params: {
  record: MaintenanceRecord
  to: MaintenanceStatus
  input: Omit<MaintenanceInput, 'trackingMode' | 'unitIds' | 'quantitySent' | 'status'>
}): Promise<void> {
  const uid = requireUid()

  if (!isSerializedMaintenance(params.record)) {
    throw new OrganizationError(
      'invalid-maintenance-record',
      'This repair is recorded as a quantity rather than individual pieces.',
    )
  }

  const check = validateSerializedStatusChange({ from: params.record.status, to: params.to })
  if (!check.valid) {
    throw new OrganizationError('invalid-maintenance-record', check.message)
  }

  const db = getFirebaseDb()
  const recordRef = doc(db, COLLECTIONS.maintenanceRecords, params.record.maintenance_id)
  const itemRef = doc(db, COLLECTIONS.inventoryItems, params.record.item_id)
  const eventRef = doc(collection(db, COLLECTIONS.assetEvents))
  const unitIds = params.record.unit_ids ?? []

  const commonInput = {
    ...params.input,
    trackingMode: 'serialized' as const,
    unitIds,
    quantitySent: unitIds.length,
    status: params.to,
  }

  if (!check.closing) {
    // The equipment stays where it is, so nothing else in the transaction moves.
    await runTransaction(db, async (transaction) => {
      const snapshot = await transaction.get(recordRef)
      if (!snapshot.exists()) {
        throw new OrganizationError('maintenance-record-not-found', 'That repair is gone.')
      }
      const record = snapshot.data() as MaintenanceRecord

      transaction.set(recordRef, buildMaintenanceUpdate({
        maintenanceId: record.maintenance_id,
        organizationId: record.organization_id,
        itemId: record.item_id,
        teamId: record.team_id,
        createdByUid: record.created_by_uid,
        createdAt: record.created_at,
        now: serverTimestamp,
        input: commonInput,
      }))
    })
    return
  }

  const unitRefs = unitIds.map((id) => doc(db, COLLECTIONS.inventoryUnits, id))

  await runTransaction(db, async (transaction) => {
    const recordSnapshot = await transaction.get(recordRef)
    const itemSnapshot = await transaction.get(itemRef)
    const unitSnapshots = await Promise.all(unitRefs.map((ref) => transaction.get(ref)))

    if (!recordSnapshot.exists()) {
      throw new OrganizationError('maintenance-record-not-found', 'That repair is gone.')
    }
    if (!itemSnapshot.exists()) {
      throw new OrganizationError('inventory-item-not-found', 'That inventory item is gone.')
    }

    const record = recordSnapshot.data() as MaintenanceRecord
    const item = itemSnapshot.data() as InventoryItem

    const stale = validateSerializedStatusChange({ from: record.status, to: params.to })
    if (!stale.valid) {
      throw new OrganizationError(
        'invalid-maintenance-record',
        'Somebody else moved this repair while this page was open. Reload and try again.',
      )
    }

    const units = unitSnapshots.map((snapshot, index) => {
      if (!snapshot.exists()) {
        throw new OrganizationError(
          'inventory-unit-not-found',
          `A unit on this repair is gone (${unitIds[index] ?? 'unknown'}).`,
        )
      }
      return snapshot.data() as InventoryUnit
    })

    for (const unit of units) {
      if (unit.status !== 'in_maintenance') {
        throw new OrganizationError(
          'invalid-maintenance-record',
          `${unit.asset_code} is not at the repair shop any more. Reload and try again.`,
        )
      }
    }

    units.forEach((unit, index) => {
      transaction.set(unitRefs[index] as DocumentReference, unitAfter({
        unit,
        status: 'available',
        eventId: eventRef.id,
        recordId: record.maintenance_id,
        // The visit stays on the unit; only the current pointer goes.
        history: unit.maintenance_record_ids ?? [],
      }))
    })

    const next = units.reduce(
      (mirrors, unit) => withStatusChanged(mirrors, {
        condition: unit.condition, from: 'in_maintenance', to: 'available',
      }),
      mirrorsOf(item),
    )

    transaction.set(itemRef, buildInventoryItemUpdate({
      itemId: item.item_id,
      organizationId: item.organization_id,
      createdByUid: item.created_by_uid,
      createdAt: item.created_at,
      now: serverTimestamp,
      input: itemInputWithMirrors(item, next),
    }))

    transaction.set(recordRef, buildMaintenanceUpdate({
      maintenanceId: record.maintenance_id,
      organizationId: record.organization_id,
      itemId: record.item_id,
      teamId: record.team_id,
      createdByUid: record.created_by_uid,
      createdAt: record.created_at,
      now: serverTimestamp,
      input: commonInput,
    }))

    transaction.set(eventRef, buildBatchAssetEventDocument({
      eventId: eventRef.id,
      organizationId: record.organization_id,
      inventoryItemId: record.item_id,
      inventoryUnitIds: unitIds,
      maintenanceRecordId: record.maintenance_id,
      uid,
      now: serverTimestamp,
      input: { eventType: 'returned_from_maintenance' },
    }))
  })
}
