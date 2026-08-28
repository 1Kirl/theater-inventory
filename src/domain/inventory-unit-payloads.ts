import type { FieldValue, Timestamp } from 'firebase/firestore'
import type { ConditionKey, RetirementReason, UnitStatus } from '@/types/inventory'

/**
 * The exact document shape written to `inventory_units`.
 *
 * Security Rules validate it with `hasExactly`, so an extra or missing field is
 * a permission-denied rather than a soft failure. Keeping the shape here lets
 * the Rules tests exercise the payload the application will actually send, the
 * way every other collection in this project already does.
 *
 * No service uses this yet. It exists in Phase 11A so the contract, the Rules,
 * and the tests are settled before anything writes a unit.
 */
export type Now = () => FieldValue

export interface InventoryUnitInput {
  assetCode: string
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
}

function optionalText(value: string | undefined) {
  const trimmed = value?.trim()
  return trimmed && trimmed.length > 0 ? trimmed : undefined
}

/**
 * Fields the user may set.
 *
 * Identity, the parent link, the owning team, and authorship are not among
 * them: those are what Rules authorize against, and a write that could change
 * them could widen who may edit the unit afterwards.
 */
function editableFields(input: InventoryUnitInput) {
  const lastKnownLocation = optionalText(input.lastKnownLocation)
  const notes = optionalText(input.notes)

  return {
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
  /** The parent's owning team, copied so Rules need not read the parent. */
  teamId: string
  uid: string
  now: Now
  input: InventoryUnitInput
}) {
  return {
    unit_id: params.unitId,
    organization_id: params.organizationId,
    inventory_item_id: params.inventoryItemId,
    team_id: params.teamId,
    ...editableFields(params.input),
    created_by_uid: params.uid,
    created_at: params.now(),
    updated_at: params.now(),
  }
}

/**
 * An update replaces the whole document rather than merging, so a field the
 * user cleared is actually removed. Identity, the parent link, the owning team,
 * authorship, and creation time are carried through unchanged and are immutable
 * in Rules.
 */
export function buildInventoryUnitUpdate(params: {
  unitId: string
  organizationId: string
  inventoryItemId: string
  teamId: string
  createdByUid: string
  createdAt: Timestamp
  now: Now
  input: InventoryUnitInput
}) {
  return {
    unit_id: params.unitId,
    organization_id: params.organizationId,
    inventory_item_id: params.inventoryItemId,
    team_id: params.teamId,
    ...editableFields(params.input),
    created_by_uid: params.createdByUid,
    created_at: params.createdAt,
    updated_at: params.now(),
  }
}
