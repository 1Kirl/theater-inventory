import type { FieldValue, Timestamp } from 'firebase/firestore'
import type { ConditionKey, RetirementReason, UnitStatus } from '@/types/inventory'

/**
 * The exact document shape written to `inventory_units`.
 *
 * Security Rules validate it with `hasExactly`, so an extra or missing field is
 * a permission-denied rather than a soft failure. Keeping the shape here lets
 * the Rules tests exercise the payload the application will actually send, the
 * way every other collection in this project already does.
 */
export type Now = () => FieldValue

export interface InventoryUnitInput {
  assetCode: string
  /** The crew this unit belongs to, which is what authorizes edits to it. */
  owningTeamId: string
  condition: ConditionKey
  status: UnitStatus
  storageLocation: string
  /** Required when the status is `retired`, meaningless otherwise. */
  retirementReason?: RetirementReason | null
  /** Set only while the unit is in use. */
  usingTeamId?: string | null
  usingMemberUid?: string | null
  checkedOutAt?: Timestamp | null
  lastKnownLocation?: string | undefined
  lastInspectedAt?: Timestamp | null
  notes?: string | undefined
  /**
   * The event that produced this status. Set only by a lifecycle action; an
   * ordinary edit carries through whatever was already there, and Rules refuse
   * a change to it that is not accompanied by a real transition.
   */
  lastLifecycleEventId?: string | undefined
}

function optionalText(value: string | undefined) {
  const trimmed = value?.trim()
  return trimmed && trimmed.length > 0 ? trimmed : undefined
}

/**
 * Fields the user may set.
 *
 * The owning team is among them. Units of one item can belong to different
 * crews, and equipment changes hands, so `team_id` is the unit's own rather than
 * a copy of its parent's. It is still what Rules authorize against, which is why
 * a move is checked at both ends rather than treated as an ordinary edit.
 *
 * Identity, the parent link, and authorship are not settable: those anchor the
 * document and changing them would make it a different unit.
 */
function editableFields(params: { input: InventoryUnitInput }) {
  const input = params.input
  const lastKnownLocation = optionalText(input.lastKnownLocation)
  const notes = optionalText(input.notes)

  return {
    team_id: input.owningTeamId,
    asset_code: input.assetCode.trim(),
    condition: input.condition,
    status: input.status,
    storage_location: input.storageLocation.trim(),
    // A retirement reason belongs to a retired unit and to nothing else, so it
    // is dropped rather than carried along by a unit that came back.
    ...(input.status === 'retired' && input.retirementReason
      ? { retirement_reason: input.retirementReason }
      : {}),
    ...(input.status === 'in_use' && input.usingTeamId
      ? { using_team_id: input.usingTeamId }
      : {}),
    ...(input.status === 'in_use' && input.usingTeamId && input.usingMemberUid
      ? { using_member_uid: input.usingMemberUid }
      : {}),
    ...(input.status === 'in_use' && input.checkedOutAt
      ? { checked_out_at: input.checkedOutAt }
      : {}),
    ...(params.input.lastLifecycleEventId
      ? { last_lifecycle_event_id: params.input.lastLifecycleEventId }
      : {}),
    ...(lastKnownLocation ? { last_known_location: lastKnownLocation } : {}),
    ...(input.lastInspectedAt ? { last_inspected_at: input.lastInspectedAt } : {}),
    ...(notes ? { notes } : {}),
  }
}

export function buildInventoryUnitDocument(params: {
  unitId: string
  organizationId: string
  /** Copied from the parent, and immutable afterwards. */
  inventoryItemId: string
  uid: string
  now: Now
  input: InventoryUnitInput
}) {
  return {
    unit_id: params.unitId,
    organization_id: params.organizationId,
    inventory_item_id: params.inventoryItemId,
    ...editableFields(params),
    created_by_uid: params.uid,
    created_at: params.now(),
    updated_at: params.now(),
  }
}

/**
 * An update replaces the whole document rather than merging, so a field the
 * user cleared is actually removed. Identity, the parent link, authorship, and
 * creation time are carried through unchanged and are immutable in Rules; the
 * owning team comes from the input, because a unit can change hands.
 */
export function buildInventoryUnitUpdate(params: {
  unitId: string
  organizationId: string
  inventoryItemId: string
  createdByUid: string
  createdAt: Timestamp
  now: Now
  input: InventoryUnitInput
}) {
  return {
    unit_id: params.unitId,
    organization_id: params.organizationId,
    inventory_item_id: params.inventoryItemId,
    ...editableFields(params),
    created_by_uid: params.createdByUid,
    created_at: params.createdAt,
    updated_at: params.now(),
  }
}
