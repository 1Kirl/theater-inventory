import type { FieldValue, Timestamp } from 'firebase/firestore'
import type {
  ConditionCounts, RetirementReason, TrackingMode, UnitCounts, UnitStatus,
} from '@/types/inventory'
import { isValidCostCents } from '@/domain/money'

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
  /**
   * Defaults to `bulk`, which is what every item written before serialized
   * tracking existed is.
   *
   * Always written, never left off. An update replaces the whole document, so a
   * form that did not carry this field forward would quietly turn a serialized
   * item back into a bulk one.
   */
  trackingMode?: TrackingMode
  /** Serialized items only. Mirrors the units; absent for a bulk item. */
  unitCounts?: UnitCounts | undefined
  quantityTotal: number
  quantityAvailable: number
  conditionCounts: ConditionCounts
  location: string
  /** Cents, or null/undefined for unknown. Never a float, never dollars. */
  unitCostCents?: number | null
  lastInspectedAt?: Timestamp | null
  notes?: string | undefined
  /**
   * A bulk item's lifecycle status, and the history it points at.
   *
   * Carried rather than set, in every caller but the lifecycle service itself.
   * An update replaces the whole document, so a form that did not pass these
   * through would silently return a retired item to `available` and drop the
   * event that explains how it got there — the same trap `trackingMode`
   * documents above, and the reason `undefined` is preserved as `undefined`
   * here instead of being defaulted.
   */
  status?: UnitStatus | undefined
  retirementReason?: RetirementReason | undefined
  lastLifecycleEventId?: string | undefined
}

/** Fields the user may set. Identity and authorship are not among them. */
function editableFields(input: InventoryItemInput) {
  const notes = input.notes?.trim()

  const trackingMode: TrackingMode = input.trackingMode ?? 'bulk'

  return {
    name: input.name.trim(),
    category: input.category,
    team_id: input.teamId,
    tracking_mode: trackingMode,
    ...(trackingMode === 'serialized' && input.unitCounts
      ? { unit_counts: input.unitCounts }
      : {}),
    quantity_total: input.quantityTotal,
    quantity_available: input.quantityAvailable,
    condition_counts: input.conditionCounts,
    location: input.location.trim(),
    // Zero is a real answer, so presence is tested rather than truthiness: a
    // free item and an unpriced one must not collapse into each other.
    ...(isValidCostCents(input.unitCostCents)
      ? { unit_cost_cents: input.unitCostCents }
      : {}),
    ...(input.lastInspectedAt ? { last_inspected_at: input.lastInspectedAt } : {}),
    ...(notes ? { notes } : {}),
    // Bulk only. A serialized item's units carry their own statuses and Rules
    // refuse the field here, so it is dropped rather than passed along if a
    // caller ever hands one over.
    ...(trackingMode === 'bulk' && input.status ? { status: input.status } : {}),
    ...(trackingMode === 'bulk' && input.status === 'retired' && input.retirementReason
      ? { retirement_reason: input.retirementReason }
      : {}),
    ...(trackingMode === 'bulk' && input.lastLifecycleEventId
      ? { last_lifecycle_event_id: input.lastLifecycleEventId }
      : {}),
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
