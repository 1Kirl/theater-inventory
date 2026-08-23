import type { FieldValue, Timestamp } from 'firebase/firestore'
import type { ConditionCounts } from '@/types/inventory'

/**
 * The exact inventory document shape written to Firestore.
 *
 * Security Rules validate it with `hasExactly`, so an extra or missing field is
 * a permission-denied rather than a soft failure. Keeping the shape here lets
 * the Rules tests exercise the payload the application actually sends.
 */
export type Now = () => FieldValue

export interface InventoryItemInput {
  name: string
  category: string
  teamId: string
  quantityTotal: number
  quantityAvailable: number
  conditionCounts: ConditionCounts
  location: string
  lastInspectedAt?: Timestamp | null
  notes?: string | undefined
}

/** Fields the user may set. Identity and authorship are not among them. */
function editableFields(input: InventoryItemInput) {
  const notes = input.notes?.trim()

  return {
    name: input.name.trim(),
    category: input.category,
    team_id: input.teamId,
    quantity_total: input.quantityTotal,
    quantity_available: input.quantityAvailable,
    condition_counts: input.conditionCounts,
    location: input.location.trim(),
    ...(input.lastInspectedAt ? { last_inspected_at: input.lastInspectedAt } : {}),
    ...(notes ? { notes } : {}),
  }
}

export function buildInventoryItemDocument(params: {
  itemId: string
  organizationId: string
  uid: string
  now: Now
  input: InventoryItemInput
}) {
  return {
    item_id: params.itemId,
    organization_id: params.organizationId,
    ...editableFields(params.input),
    created_by_uid: params.uid,
    created_at: params.now(),
    updated_at: params.now(),
  }
}

/**
 * An update replaces the whole document rather than merging, so a field the
 * user cleared is actually removed. Identity, authorship, and creation time are
 * carried through unchanged and are immutable in Rules.
 */
export function buildInventoryItemUpdate(params: {
  itemId: string
  organizationId: string
  createdByUid: string
  createdAt: Timestamp
  now: Now
  input: InventoryItemInput
}) {
  return {
    item_id: params.itemId,
    organization_id: params.organizationId,
    ...editableFields(params.input),
    created_by_uid: params.createdByUid,
    created_at: params.createdAt,
    updated_at: params.now(),
  }
}
