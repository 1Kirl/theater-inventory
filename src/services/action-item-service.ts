import {
  collection, doc, getDocs, query, serverTimestamp, setDoc, updateDoc, where,
} from 'firebase/firestore'
import { getFirebaseAuth, getFirebaseDb } from '@/lib/firebase'
import { COLLECTIONS } from '@/domain/organization-ids'
import { OrganizationError } from '@/domain/organization-errors'
import {
  buildActionItemDocument,
  buildActionItemUpdate,
  type ActionItemInput,
} from '@/domain/production-payloads'
import { canCreateActionItem, validateActionQuantity } from '@/domain/production'
import type { RequirementAvailability } from '@/domain/production'
import type { ActionItem, ActionStatus, ProductionRequirement } from '@/types/production'

const MAX_NOTES_LENGTH = 2000

function requireUid(): string {
  const user = getFirebaseAuth().currentUser
  if (!user) throw new OrganizationError('not-signed-in', 'You are not signed in.')
  return user.uid
}

function validate(input: ActionItemInput): void {
  const quantity = validateActionQuantity(input.quantity)
  if (!quantity.valid) {
    throw new OrganizationError('invalid-action-item', quantity.message)
  }

  if ((input.notes?.trim().length ?? 0) > MAX_NOTES_LENGTH) {
    throw new OrganizationError(
      'invalid-action-item',
      `Notes must be ${MAX_NOTES_LENGTH} characters or fewer.`,
    )
  }
}

/**
 * Change only the status, for the Action List's quick operational control.
 *
 * A partial write: Security Rules validate the merged document, so the
 * relation fields and authorship stay untouched and are still checked as
 * immutable. Everything else about an action is edited from the production it
 * belongs to.
 *
 * The shortage is deliberately not re-examined. Once inventory arrives the
 * shortage clears, and closing the work has to remain possible.
 */
export async function updateActionItemStatus(params: {
  actionItemId: string
  status: ActionStatus
}): Promise<void> {
  requireUid()

  await updateDoc(doc(getFirebaseDb(), COLLECTIONS.actionItems, params.actionItemId), {
    status: params.status,
    updated_at: serverTimestamp(),
  })
}

/** The whole organization's action list. */
export async function listActionItems(organizationId: string): Promise<ActionItem[]> {
  const snapshot = await getDocs(
    query(
      collection(getFirebaseDb(), COLLECTIONS.actionItems),
      where('organization_id', '==', organizationId),
    ),
  )
  return snapshot.docs.map((entry) => entry.data() as ActionItem)
}

export async function listActionItemsForProduction(params: {
  organizationId: string
  productionId: string
}): Promise<ActionItem[]> {
  const snapshot = await getDocs(
    query(
      collection(getFirebaseDb(), COLLECTIONS.actionItems),
      where('organization_id', '==', params.organizationId),
      where('production_id', '==', params.productionId),
    ),
  )
  return snapshot.docs.map((entry) => entry.data() as ActionItem)
}

/**
 * Create or update the single Action Item for a requirement.
 *
 * A new one is refused unless the requirement is matched and actually short —
 * an unmatched requirement has no shortage to act on, and a satisfied one needs
 * no work. Security Rules enforce the same two conditions at creation.
 *
 * An existing Action Item is not re-checked against the shortage: its quantity
 * records what the crew decided to do, and marking it done after the shortage
 * clears has to stay possible.
 */
export async function saveActionItem(params: {
  requirement: ProductionRequirement
  availability: RequirementAvailability
  existing: ActionItem | null
  input: ActionItemInput
}): Promise<void> {
  const uid = requireUid()
  validate(params.input)

  if (!params.existing && !canCreateActionItem(params.availability)) {
    throw new OrganizationError(
      'requirement-not-actionable',
      params.availability.matched
        ? 'This requirement is already covered by available inventory, so there is nothing to action.'
        : 'Match this requirement to an inventory item before planning an action.',
    )
  }

  const db = getFirebaseDb()
  const ref = doc(db, COLLECTIONS.actionItems, params.requirement.requirement_id)

  if (params.existing) {
    await setDoc(
      ref,
      buildActionItemUpdate({
        requirementId: params.requirement.requirement_id,
        organizationId: params.requirement.organization_id,
        productionId: params.requirement.production_id,
        itemName: params.requirement.item_name,
        teamId: params.requirement.team_id,
        createdByUid: params.existing.created_by_uid,
        createdAt: params.existing.created_at,
        now: serverTimestamp,
        input: params.input,
      }),
    )
    return
  }

  await setDoc(
    ref,
    buildActionItemDocument({
      requirementId: params.requirement.requirement_id,
      organizationId: params.requirement.organization_id,
      productionId: params.requirement.production_id,
      itemName: params.requirement.item_name,
      teamId: params.requirement.team_id,
      uid,
      now: serverTimestamp,
      input: params.input,
    }),
  )
}
