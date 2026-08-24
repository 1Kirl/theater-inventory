import { collection, doc, getDoc, getDocs, query, serverTimestamp, setDoc, where } from 'firebase/firestore'
import { getFirebaseAuth, getFirebaseDb } from '@/lib/firebase'
import { COLLECTIONS } from '@/domain/organization-ids'
import { OrganizationError } from '@/domain/organization-errors'
import {
  buildProductionDocument,
  buildProductionUpdate,
  type ProductionInput,
} from '@/domain/production-payloads'
import type { Production } from '@/types/production'

const MAX_TITLE_LENGTH = 120
const MAX_TEXT_LENGTH = 2000

function requireUid(): string {
  const user = getFirebaseAuth().currentUser
  if (!user) throw new OrganizationError('not-signed-in', 'You are not signed in.')
  return user.uid
}

function validate(input: ProductionInput): void {
  const title = input.title.trim()
  if (title.length === 0 || title.length > MAX_TITLE_LENGTH) {
    throw new OrganizationError(
      'invalid-production',
      `Production title must be between 1 and ${MAX_TITLE_LENGTH} characters.`,
    )
  }

  for (const [label, value] of [
    ['Description', input.description],
    ['Notes', input.notes],
  ] as const) {
    if ((value?.trim().length ?? 0) > MAX_TEXT_LENGTH) {
      throw new OrganizationError(
        'invalid-production',
        `${label} must be ${MAX_TEXT_LENGTH} characters or fewer.`,
      )
    }
  }

  if (input.startDate && input.endDate && input.endDate.toMillis() < input.startDate.toMillis()) {
    throw new OrganizationError('invalid-production', 'End date cannot be before the start date.')
  }
}

/** Productions are organization-level: one equality filter, no team clause. */
export async function listProductions(organizationId: string): Promise<Production[]> {
  const snapshot = await getDocs(
    query(
      collection(getFirebaseDb(), COLLECTIONS.productions),
      where('organization_id', '==', organizationId),
    ),
  )

  return snapshot.docs
    .map((entry) => entry.data() as Production)
    .sort((left, right) => left.title.localeCompare(right.title))
}

export async function getProduction(productionId: string): Promise<Production | null> {
  const snapshot = await getDoc(doc(getFirebaseDb(), COLLECTIONS.productions, productionId))
  return snapshot.exists() ? (snapshot.data() as Production) : null
}

export async function createProduction(params: {
  organizationId: string
  input: ProductionInput
}): Promise<{ productionId: string }> {
  const uid = requireUid()
  validate(params.input)

  const db = getFirebaseDb()
  const ref = doc(collection(db, COLLECTIONS.productions))

  await setDoc(
    ref,
    buildProductionDocument({
      productionId: ref.id,
      organizationId: params.organizationId,
      uid,
      now: serverTimestamp,
      input: params.input,
    }),
  )

  return { productionId: ref.id }
}

export async function updateProduction(params: {
  existing: Production
  input: ProductionInput
}): Promise<void> {
  requireUid()
  validate(params.input)

  await setDoc(
    doc(getFirebaseDb(), COLLECTIONS.productions, params.existing.production_id),
    buildProductionUpdate({
      productionId: params.existing.production_id,
      organizationId: params.existing.organization_id,
      createdByUid: params.existing.created_by_uid,
      createdAt: params.existing.created_at,
      now: serverTimestamp,
      input: params.input,
    }),
  )
}
