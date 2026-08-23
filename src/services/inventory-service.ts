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
  buildInventoryItemDocument,
  buildInventoryItemUpdate,
  type InventoryItemInput,
} from '@/domain/inventory-payloads'
import { validateInventoryQuantities } from '@/domain/inventory'
import type { InventoryItem } from '@/types/inventory'

const MAX_NAME_LENGTH = 120
const MAX_LOCATION_LENGTH = 120
const MAX_NOTES_LENGTH = 2000

function requireUid(): string {
  const user = getFirebaseAuth().currentUser
  if (!user) {
    throw new OrganizationError('not-signed-in', 'You are not signed in.')
  }
  return user.uid
}

function validateInput(input: InventoryItemInput): void {
  if (input.name.trim().length === 0 || input.name.trim().length > MAX_NAME_LENGTH) {
    throw new OrganizationError(
      'invalid-inventory-item',
      `Item name must be between 1 and ${MAX_NAME_LENGTH} characters.`,
    )
  }

  if (input.category.trim().length === 0) {
    throw new OrganizationError('invalid-inventory-item', 'Choose a category.')
  }

  if (input.teamId.trim().length === 0) {
    throw new OrganizationError('invalid-inventory-item', 'Choose an owning team.')
  }

  if (input.location.trim().length === 0 || input.location.trim().length > MAX_LOCATION_LENGTH) {
    throw new OrganizationError(
      'invalid-inventory-item',
      `Storage location must be between 1 and ${MAX_LOCATION_LENGTH} characters.`,
    )
  }

  if ((input.notes?.trim().length ?? 0) > MAX_NOTES_LENGTH) {
    throw new OrganizationError(
      'invalid-inventory-item',
      `Notes must be ${MAX_NOTES_LENGTH} characters or fewer.`,
    )
  }

  const quantities = validateInventoryQuantities({
    quantityTotal: input.quantityTotal,
    quantityAvailable: input.quantityAvailable,
    conditionCounts: input.conditionCounts,
  })

  if (!quantities.valid) {
    throw new OrganizationError('invalid-inventory-item', quantities.message)
  }
}

/**
 * Every item in the organization, for Admin and member alike.
 *
 * Team scope is an editing boundary, not a reading one, so this query needs no
 * team filter and no composite index — one equality filter, which single-field
 * indexes already serve. Sorting happens here rather than in the query for the
 * same reason: an orderBy on a second field would require an index.
 */
export async function listInventoryItems(organizationId: string): Promise<InventoryItem[]> {
  const snapshot = await getDocs(
    query(
      collection(getFirebaseDb(), COLLECTIONS.inventoryItems),
      where('organization_id', '==', organizationId),
    ),
  )

  return snapshot.docs
    .map((entry) => entry.data() as InventoryItem)
    .sort((left, right) => left.name.localeCompare(right.name))
}

export async function getInventoryItem(itemId: string): Promise<InventoryItem | null> {
  const snapshot = await getDoc(doc(getFirebaseDb(), COLLECTIONS.inventoryItems, itemId))
  return snapshot.exists() ? (snapshot.data() as InventoryItem) : null
}

/**
 * Admin may use any team in the organization; a member with `inventory: edit`
 * may only use one of their own. Security Rules enforce both, and check the
 * team belongs to the same organization.
 */
export async function createInventoryItem(params: {
  organizationId: string
  input: InventoryItemInput
}): Promise<{ itemId: string }> {
  const uid = requireUid()
  validateInput(params.input)

  const db = getFirebaseDb()
  const itemRef = doc(collection(db, COLLECTIONS.inventoryItems))

  await setDoc(
    itemRef,
    buildInventoryItemDocument({
      itemId: itemRef.id,
      organizationId: params.organizationId,
      uid,
      now: serverTimestamp,
      input: params.input,
    }),
  )

  return { itemId: itemRef.id }
}

export async function updateInventoryItem(params: {
  existing: InventoryItem
  input: InventoryItemInput
}): Promise<void> {
  requireUid()
  validateInput(params.input)

  await setDoc(
    doc(getFirebaseDb(), COLLECTIONS.inventoryItems, params.existing.item_id),
    buildInventoryItemUpdate({
      itemId: params.existing.item_id,
      organizationId: params.existing.organization_id,
      createdByUid: params.existing.created_by_uid,
      createdAt: params.existing.created_at,
      now: serverTimestamp,
      input: params.input,
    }),
  )
}
