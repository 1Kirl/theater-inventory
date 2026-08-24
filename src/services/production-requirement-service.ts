import { collection, doc, getDoc, getDocs, query, serverTimestamp, setDoc, where } from 'firebase/firestore'
import { getFirebaseAuth, getFirebaseDb } from '@/lib/firebase'
import { COLLECTIONS } from '@/domain/organization-ids'
import { OrganizationError } from '@/domain/organization-errors'
import {
  buildRequirementDocument,
  buildRequirementUpdate,
  type RequirementInput,
} from '@/domain/production-payloads'
import { validateRequiredQuantity } from '@/domain/production'
import type { ProductionRequirement } from '@/types/production'

const MAX_NAME_LENGTH = 120
const MAX_NOTES_LENGTH = 2000

function requireUid(): string {
  const user = getFirebaseAuth().currentUser
  if (!user) throw new OrganizationError('not-signed-in', 'You are not signed in.')
  return user.uid
}

function validate(input: RequirementInput): void {
  const name = input.itemName.trim()
  if (name.length === 0 || name.length > MAX_NAME_LENGTH) {
    throw new OrganizationError(
      'invalid-requirement',
      `Item name must be between 1 and ${MAX_NAME_LENGTH} characters.`,
    )
  }

  if (input.teamId.trim().length === 0) {
    throw new OrganizationError('invalid-requirement', 'Choose the responsible team.')
  }

  if ((input.notes?.trim().length ?? 0) > MAX_NOTES_LENGTH) {
    throw new OrganizationError(
      'invalid-requirement',
      `Notes must be ${MAX_NOTES_LENGTH} characters or fewer.`,
    )
  }

  const quantity = validateRequiredQuantity(input.requiredQty)
  if (!quantity.valid) {
    throw new OrganizationError('invalid-requirement', quantity.message)
  }
}

/** Requirements for one production. Reading is organization-wide. */
export async function listRequirementsForProduction(params: {
  organizationId: string
  productionId: string
}): Promise<ProductionRequirement[]> {
  const snapshot = await getDocs(
    query(
      collection(getFirebaseDb(), COLLECTIONS.productionRequirements),
      where('organization_id', '==', params.organizationId),
      where('production_id', '==', params.productionId),
    ),
  )

  return snapshot.docs
    .map((entry) => entry.data() as ProductionRequirement)
    .sort((left, right) => left.item_name.localeCompare(right.item_name))
}

export async function listRequirements(organizationId: string): Promise<ProductionRequirement[]> {
  const snapshot = await getDocs(
    query(
      collection(getFirebaseDb(), COLLECTIONS.productionRequirements),
      where('organization_id', '==', organizationId),
    ),
  )
  return snapshot.docs.map((entry) => entry.data() as ProductionRequirement)
}

export async function getRequirement(requirementId: string): Promise<ProductionRequirement | null> {
  const snapshot = await getDoc(
    doc(getFirebaseDb(), COLLECTIONS.productionRequirements, requirementId),
  )
  return snapshot.exists() ? (snapshot.data() as ProductionRequirement) : null
}

export async function createRequirement(params: {
  organizationId: string
  productionId: string
  input: RequirementInput
}): Promise<{ requirementId: string }> {
  const uid = requireUid()
  validate(params.input)

  const db = getFirebaseDb()
  const ref = doc(collection(db, COLLECTIONS.productionRequirements))

  await setDoc(
    ref,
    buildRequirementDocument({
      requirementId: ref.id,
      organizationId: params.organizationId,
      productionId: params.productionId,
      uid,
      now: serverTimestamp,
      input: params.input,
    }),
  )

  return { requirementId: ref.id }
}

export async function updateRequirement(params: {
  existing: ProductionRequirement
  input: RequirementInput
}): Promise<void> {
  requireUid()
  validate(params.input)

  await setDoc(
    doc(getFirebaseDb(), COLLECTIONS.productionRequirements, params.existing.requirement_id),
    buildRequirementUpdate({
      requirementId: params.existing.requirement_id,
      organizationId: params.existing.organization_id,
      productionId: params.existing.production_id,
      source: params.existing.source,
      createdByUid: params.existing.created_by_uid,
      createdAt: params.existing.created_at,
      now: serverTimestamp,
      input: params.input,
    }),
  )
}
