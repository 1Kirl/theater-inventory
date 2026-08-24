import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore'
import { getFirebaseAuth, getFirebaseDb } from '@/lib/firebase'
import { COLLECTIONS } from '@/domain/organization-ids'
import { OrganizationError } from '@/domain/organization-errors'
import {
  buildMaintenanceDocument,
  buildMaintenanceUpdate,
  type MaintenanceInput,
} from '@/domain/maintenance-payloads'
import { validateQuantitySent } from '@/domain/maintenance'
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

  await setDoc(
    recordRef,
    buildMaintenanceDocument({
      maintenanceId: recordRef.id,
      organizationId: params.organizationId,
      itemId: item.item_id,
      teamId: item.team_id,
      uid,
      now: serverTimestamp,
      input: params.input,
    }),
  )

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
  requireUid()

  const item = await getInventoryItem(params.existing.item_id)
  if (!item) {
    throw new OrganizationError(
      'inventory-item-not-found',
      'The inventory item this record refers to was not found.',
    )
  }

  validateInput(params.input, item.quantity_total)

  await setDoc(
    doc(getFirebaseDb(), COLLECTIONS.maintenanceRecords, params.existing.maintenance_id),
    buildMaintenanceUpdate({
      maintenanceId: params.existing.maintenance_id,
      organizationId: params.existing.organization_id,
      itemId: params.existing.item_id,
      teamId: params.existing.team_id,
      createdByUid: params.existing.created_by_uid,
      createdAt: params.existing.created_at,
      now: serverTimestamp,
      input: params.input,
    }),
  )
}
