import type { Timestamp } from 'firebase/firestore'
import type { RetirementReason, UnitStatus } from '@/types/inventory'

/**
 * What happened to a piece of equipment.
 *
 * Lifecycle history only. Renaming a unit, moving it on a shelf, or correcting
 * a note leaves no event — those are corrections to a description, not things
 * that happened to the object. Five verbs cover what does.
 */
export const ASSET_EVENT_TYPES = [
  'marked_in_use',
  'checked_in',
  'marked_lost',
  'marked_found',
  'retired',
] as const

export type AssetEventType = (typeof ASSET_EVENT_TYPES)[number]

/**
 * Path: asset_events/{eventId}
 *
 * Append-only, and deliberately not a source of truth. The unit document is
 * authoritative for what a unit is now; these records say how it got there.
 * Replaying them is not how current state is derived, which is why they carry
 * only the fields that make a history line readable rather than a snapshot of
 * the whole unit.
 */
export interface AssetEvent {
  event_id: string
  organization_id: string
  inventory_item_id: string
  inventory_unit_id: string

  event_type: AssetEventType
  from_status: UnitStatus
  to_status: UnitStatus

  /**
   * Who had the equipment. On `marked_in_use` this is who is taking it; on
   * `checked_in` and `marked_lost` it is who had it beforehand, which the unit
   * document is about to stop recording. That is the whole reason it is copied
   * here: after a check-in, this log is the only place that answers who had it.
   */
  using_team_id?: string
  using_member_uid?: string

  /** Required on `retired`, meaningless otherwise. */
  retirement_reason?: RetirementReason
  note?: string

  actor_uid: string
  occurred_at: Timestamp
}
