import type { FieldValue } from 'firebase/firestore'
import type { AssetEventType, BatchEventType } from '@/types/asset-event'
import type { RetirementReason, UnitStatus } from '@/types/inventory'

/**
 * The exact document shape written to `asset_events`.
 *
 * Security Rules validate it with `hasExactly`, so an extra or missing field is
 * a permission denial rather than a soft failure. Keeping the shape here lets
 * the Rules tests exercise the payload the application actually sends, the way
 * every other collection in this project already does.
 */
export type Now = () => FieldValue

export interface AssetEventInput {
  eventType: AssetEventType
  fromStatus: UnitStatus
  toStatus: UnitStatus
  /** Who had the equipment: taking it, or handing it back. */
  usingTeamId?: string | null
  usingMemberUid?: string | null
  retirementReason?: RetirementReason | null
  note?: string | undefined
}

function optionalText(value: string | undefined) {
  const trimmed = value?.trim()
  return trimmed && trimmed.length > 0 ? trimmed : undefined
}

export function buildAssetEventDocument(params: {
  eventId: string
  organizationId: string
  inventoryItemId: string
  inventoryUnitId: string
  uid: string
  now: Now
  input: AssetEventInput
}) {
  const note = optionalText(params.input.note)

  return {
    event_id: params.eventId,
    organization_id: params.organizationId,
    inventory_item_id: params.inventoryItemId,
    inventory_unit_id: params.inventoryUnitId,

    event_type: params.input.eventType,
    from_status: params.input.fromStatus,
    to_status: params.input.toStatus,

    // Recorded whenever there was a borrower, whichever direction the
    // equipment was moving.
    ...(params.input.usingTeamId ? { using_team_id: params.input.usingTeamId } : {}),
    ...(params.input.usingTeamId && params.input.usingMemberUid
      ? { using_member_uid: params.input.usingMemberUid }
      : {}),
    // A retirement reason belongs to a retirement and to nothing else.
    ...(params.input.toStatus === 'retired' && params.input.retirementReason
      ? { retirement_reason: params.input.retirementReason }
      : {}),
    ...(note ? { note } : {}),

    actor_uid: params.uid,
    occurred_at: params.now(),
  }
}

/** The event a given move produces. One verb per move; no others exist. */
export function eventTypeFor(from: UnitStatus, to: UnitStatus): AssetEventType | null {
  if (to === 'retired') return 'retired'
  if (from === 'available' && to === 'in_use') return 'marked_in_use'
  if (from === 'in_use' && to === 'available') return 'checked_in'
  if (to === 'lost') return 'marked_lost'
  if (from === 'lost' && to === 'available') return 'marked_found'
  return null
}


/**
 * The event a whole batch of equipment shares when it goes for repair or comes
 * back.
 *
 * One document names every unit, and every unit names it. Security Rules read a
 * shared document once however many units point at it, which is the difference
 * between six units per repair and two hundred.
 */
export function buildBatchAssetEventDocument(params: {
  eventId: string
  organizationId: string
  inventoryItemId: string
  inventoryUnitIds: readonly string[]
  maintenanceRecordId: string
  uid: string
  now: Now
  input: { eventType: BatchEventType; note?: string | undefined }
}) {
  const note = optionalText(params.input.note)
  const sending = params.input.eventType === 'sent_to_maintenance'

  return {
    event_id: params.eventId,
    organization_id: params.organizationId,
    inventory_item_id: params.inventoryItemId,
    inventory_unit_ids: [...params.inventoryUnitIds],
    maintenance_record_id: params.maintenanceRecordId,

    event_type: params.input.eventType,
    from_status: (sending ? 'available' : 'in_maintenance') as UnitStatus,
    to_status: (sending ? 'in_maintenance' : 'available') as UnitStatus,

    ...(note ? { note } : {}),

    actor_uid: params.uid,
    occurred_at: params.now(),
  }
}
