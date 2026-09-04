import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  where,
  type DocumentReference,
  type Transaction,
} from 'firebase/firestore'
import { getFirebaseAuth, getFirebaseDb } from '@/lib/firebase'
import { COLLECTIONS } from '@/domain/organization-ids'
import { OrganizationError } from '@/domain/organization-errors'
import {
  buildMaintenanceDocument,
  buildMaintenanceUpdate,
  type MaintenanceInput,
} from '@/domain/maintenance-payloads'
import { bulkMaintenanceStatusFor, validateQuantitySent } from '@/domain/maintenance'
import { isSerialized, itemStatusOf } from '@/domain/inventory'
import { buildInventoryItemUpdate } from '@/domain/inventory-payloads'
import { buildItemAssetEventDocument, itemEventTypeFor } from '@/domain/asset-event-payloads'
import type { InventoryItem } from '@/types/inventory'
import { getInventoryItem } from '@/services/inventory-service'
import type { MaintenanceRecord } from '@/types/maintenance'

const MAX_ISSUE_LENGTH = 1000
const MAX_PROVIDER_LENGTH = 120
const MAX_NOTES_LENGTH = 2000

function requireUid(): string {
  const user = getFirebaseAuth().currentUser
  if (!user) {
    throw new OrganizationError('not-signed-in', 'You are not signed in.')
  }
  return user.uid
}

function validateInput(input: MaintenanceInput, itemQuantityTotal: number): void {
  if (
    input.issueDescription.trim().length === 0 ||
    input.issueDescription.trim().length > MAX_ISSUE_LENGTH
  ) {
    throw new OrganizationError(
      'invalid-maintenance-record',
      `Describe the issue in 1 to ${MAX_ISSUE_LENGTH} characters.`,
    )
  }

  for (const [label, value] of [
    ['Service provider name', input.serviceProviderName],
    ['Service provider phone', input.serviceProviderPhone],
    ['Service provider email', input.serviceProviderEmail],
  ] as const) {
    if ((value?.trim().length ?? 0) > MAX_PROVIDER_LENGTH) {
      throw new OrganizationError(
        'invalid-maintenance-record',
        `${label} must be ${MAX_PROVIDER_LENGTH} characters or fewer.`,
      )
    }
  }

  if ((input.repairNotes?.trim().length ?? 0) > MAX_NOTES_LENGTH) {
    throw new OrganizationError(
      'invalid-maintenance-record',
      `Repair notes must be ${MAX_NOTES_LENGTH} characters or fewer.`,
    )
  }

  if (typeof input.cost === 'number' && (!Number.isFinite(input.cost) || input.cost < 0)) {
    throw new OrganizationError('invalid-maintenance-record', 'Cost cannot be negative.')
  }

  const quantity = validateQuantitySent({
    quantitySent: input.quantitySent,
    itemQuantityTotal,
  })
  if (!quantity.valid) {
    throw new OrganizationError('invalid-maintenance-record', quantity.message)
  }
}

/**
 * Every maintenance record in the organization.
 *
 * Reading is organization-wide for anyone holding the maintenance module, the
 * same shape as inventory, so one equality filter serves every role and no
 * composite index is needed.
 */
export async function listMaintenanceRecords(
  organizationId: string,
): Promise<MaintenanceRecord[]> {
  const snapshot = await getDocs(
    query(
      collection(getFirebaseDb(), COLLECTIONS.maintenanceRecords),
      where('organization_id', '==', organizationId),
    ),
  )

  return snapshot.docs.map((entry) => entry.data() as MaintenanceRecord).sort(byNewestFirst)
}

/** One item's history, for the inventory detail page and the in-service figure. */
export async function listMaintenanceRecordsForItem(params: {
  organizationId: string
  itemId: string
}): Promise<MaintenanceRecord[]> {
  const snapshot = await getDocs(
    query(
      collection(getFirebaseDb(), COLLECTIONS.maintenanceRecords),
      where('organization_id', '==', params.organizationId),
      where('item_id', '==', params.itemId),
    ),
  )

  return snapshot.docs.map((entry) => entry.data() as MaintenanceRecord).sort(byNewestFirst)
}

function byNewestFirst(left: MaintenanceRecord, right: MaintenanceRecord): number {
  const leftTime = left.created_at?.toMillis?.() ?? 0
  const rightTime = right.created_at?.toMillis?.() ?? 0
  return rightTime - leftTime
}

export async function getMaintenanceRecord(
  maintenanceId: string,
): Promise<MaintenanceRecord | null> {
  const snapshot = await getDoc(
    doc(getFirebaseDb(), COLLECTIONS.maintenanceRecords, maintenanceId),
  )
  return snapshot.exists() ? (snapshot.data() as MaintenanceRecord) : null
}

/**
 * The team is read from the linked item and copied, never taken from the caller.
 * Security Rules verify the copy matches, so a crafted team cannot widen who may
 * edit the record afterwards.
 */
/**
 * Move a bulk item's lifecycle status to match the repairs filed against it.
 *
 * The item-level counterpart of what `sendUnitsToMaintenance` and
 * `updateSerializedMaintenance` do to units: the equipment's status and the
 * repair record move in one write, so equipment can never claim to be at a shop
 * with no repair behind it, nor sit at one after the last repair closed.
 *
 * Serialized items are skipped entirely. Their units carry their own statuses
 * and the existing serialized services already move them; an item-level status
 * would be a second, conflicting answer, and Rules refuse the field there.
 *
 * `quantity_sent` is untouched, here and everywhere. How many pieces went out
 * is a different question from whether the group is away, and this answers only
 * the second.
 *
 * The other records are read *before* the transaction, because Firestore
 * transactions cannot run queries. That is a real if narrow race — two repairs
 * closing at the same instant could each believe the other was still open — and
 * it is bounded by Rules: the status can only move along a legal edge carrying
 * a matching event, so the worst case is a status that needs correcting by
 * opening or closing a repair, never a corrupt one.
 */
async function planItemStatusMove(params: {
  item: InventoryItem
  /** Every record for this item after the write, including the one being written. */
  recordsAfter: readonly Pick<MaintenanceRecord, 'status'>[]
}): Promise<{ to: 'available' | 'in_maintenance'; from: string } | null> {
  if (isSerialized(params.item)) return null

  const from = itemStatusOf(params.item)
  const to = bulkMaintenanceStatusFor(from, params.recordsAfter)
  if (!to || (to !== 'available' && to !== 'in_maintenance')) return null

  return { to, from }
}

/** Write the item's new status and the event that explains it, in the same commit. */
function applyItemStatusMove(
  transaction: Transaction,
  params: {
    item: InventoryItem
    move: { to: 'available' | 'in_maintenance'; from: string }
    itemRef: DocumentReference
    eventRef: DocumentReference
    uid: string
  },
): void {
  const { item, move } = params
  const eventType = itemEventTypeFor(move.from as never, move.to)
  if (!eventType) return

  transaction.set(params.itemRef, buildInventoryItemUpdate({
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
      // Quantities and condition are carried through untouched: a repair moves
      // the group's status, never how much of it there is.
      quantityTotal: item.quantity_total,
      quantityAvailable: item.quantity_available,
      conditionCounts: item.condition_counts,
      location: item.location,
      unitCostCents: item.unit_cost_cents ?? null,
      lastInspectedAt: item.last_inspected_at ?? null,
      notes: item.notes,
      status: move.to,
      lastLifecycleEventId: params.eventRef.id,
    },
  }))

  transaction.set(params.eventRef, buildItemAssetEventDocument({
    eventId: params.eventRef.id,
    organizationId: item.organization_id,
    inventoryItemId: item.item_id,
    uid: params.uid,
    now: serverTimestamp,
    input: { eventType, fromStatus: move.from as never, toStatus: move.to },
  }))
}

export async function createMaintenanceRecord(params: {
  organizationId: string
  itemId: string
  input: MaintenanceInput
}): Promise<{ maintenanceId: string }> {
  const uid = requireUid()

  const item = await getInventoryItem(params.itemId)
  if (!item || item.organization_id !== params.organizationId) {
    throw new OrganizationError(
      'inventory-item-not-found',
      'That inventory item was not found in this organization.',
    )
  }

  validateInput(params.input, item.quantity_total)

  const db = getFirebaseDb()
  const recordRef = doc(collection(db, COLLECTIONS.maintenanceRecords))
  const itemRef = doc(db, COLLECTIONS.inventoryItems, item.item_id)
  const eventRef = doc(collection(db, COLLECTIONS.assetEvents))

  // Read before the transaction opens; Firestore transactions cannot query.
  const existing = await listMaintenanceRecordsForItem({
    organizationId: params.organizationId, itemId: item.item_id,
  })
  const move = await planItemStatusMove({
    item,
    recordsAfter: [...existing, { status: params.input.status }],
  })

  const document = buildMaintenanceDocument({
    maintenanceId: recordRef.id,
    organizationId: params.organizationId,
    itemId: item.item_id,
    teamId: item.team_id,
    uid,
    now: serverTimestamp,
    input: params.input,
  })

  if (!move) {
    await setDoc(recordRef, document)
    return { maintenanceId: recordRef.id }
  }

  // The repair and the group's status go together, or neither does.
  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(itemRef)
    if (!snapshot.exists()) {
      throw new OrganizationError('inventory-item-not-found', 'That inventory item is gone.')
    }
    const fresh = snapshot.data() as InventoryItem
    transaction.set(recordRef, document)
    applyItemStatusMove(transaction, { item: fresh, move, itemRef, eventRef, uid })
  })

  return { maintenanceId: recordRef.id }
}

/**
 * The item link and the team snapshot are carried through unchanged; both are
 * immutable in Rules. Quantity is still checked against the item's current
 * total, which is what Rules check too.
 */
export async function updateMaintenanceRecord(params: {
  existing: MaintenanceRecord
  input: MaintenanceInput
}): Promise<void> {

  const item = await getInventoryItem(params.existing.item_id)
  if (!item) {
    throw new OrganizationError(
      'inventory-item-not-found',
      'The inventory item this record refers to was not found.',
    )
  }

  validateInput(params.input, item.quantity_total)

  const uid = requireUid()
  const db = getFirebaseDb()
  const recordRef = doc(db, COLLECTIONS.maintenanceRecords, params.existing.maintenance_id)
  const itemRef = doc(db, COLLECTIONS.inventoryItems, item.item_id)
  const eventRef = doc(collection(db, COLLECTIONS.assetEvents))

  const others = (await listMaintenanceRecordsForItem({
    organizationId: params.existing.organization_id, itemId: params.existing.item_id,
  })).filter((record) => record.maintenance_id !== params.existing.maintenance_id)

  const move = await planItemStatusMove({
    item,
    recordsAfter: [...others, { status: params.input.status }],
  })

  const document = buildMaintenanceUpdate({
    maintenanceId: params.existing.maintenance_id,
    organizationId: params.existing.organization_id,
    itemId: params.existing.item_id,
    teamId: params.existing.team_id,
    createdByUid: params.existing.created_by_uid,
    createdAt: params.existing.created_at,
    now: serverTimestamp,
    input: params.input,
  })

  if (!move) {
    await setDoc(recordRef, document)
    return
  }

  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(itemRef)
    if (!snapshot.exists()) {
      throw new OrganizationError('inventory-item-not-found', 'That inventory item is gone.')
    }
    const fresh = snapshot.data() as InventoryItem
    transaction.set(recordRef, document)
    applyItemStatusMove(transaction, { item: fresh, move, itemRef, eventRef, uid })
  })
}
