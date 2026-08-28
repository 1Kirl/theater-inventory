import type { Timestamp } from 'firebase/firestore'

export type ConditionKey = 'excellent' | 'good' | 'fair' | 'needs_repair' | 'unusable'

export type ConditionCounts = Record<ConditionKey, number>

/**
 * Categories from PROJECT_SPEC section 7.4. A fixed list rather than free text,
 * so the category filter has something stable to offer.
 */
export const INVENTORY_CATEGORIES = [
  'Lighting Instruments',
  'Cables',
  'Lighting Accessories',
  'Sound Equipment',
  'Microphones',
  'Tools',
  'Set-Building Materials',
  'Platforms / Flats',
  'Props',
  'Costumes',
  'Hardware',
  'Miscellaneous Technical Equipment',
] as const

export type InventoryCategory = (typeof INVENTORY_CATEGORIES)[number]

/**
 * How an item accounts for the physical things it represents.
 *
 * `bulk` is the original model: one document holding quantities a person
 * maintains. `serialized` gives each physical object its own document, so a
 * question like "which of the twenty-four is missing" has an answer.
 *
 * Chosen per item by the user, never derived from the category — a clamp worth
 * tracking individually in one school is a box of hardware in another.
 */
export const TRACKING_MODES = ['bulk', 'serialized'] as const
export type TrackingMode = (typeof TRACKING_MODES)[number]

/**
 * Where a physical unit is in its life, which is a different question from what
 * condition it is in.
 *
 * A unit can be `available` and unusable, or `in_use` and merely fair. Folding
 * the two into one field would make one of those two states unsayable.
 */
export const UNIT_STATUSES = [
  'available',
  'in_use',
  'in_maintenance',
  'lost',
  'retired',
] as const
export type UnitStatus = (typeof UNIT_STATUSES)[number]

/** Why a unit stopped being an active asset. Required when it is retired. */
export const RETIREMENT_REASONS = [
  'disposed',
  'permanently_lost',
  'donated',
  'sold',
  'other',
] as const
export type RetirementReason = (typeof RETIREMENT_REASONS)[number]

/**
 * The summary a serialized item carries so the list, the dashboard, production
 * shortages, and the AI context never have to read individual units.
 *
 * `active_total` excludes retired units; `retired` is kept beside it as history
 * rather than folded in.
 *
 * The obvious invariant is deliberately *not* the obvious one:
 *
 *     active_total === available + unusable_on_hand + in_use + in_maintenance + lost
 *
 * `unusable_on_hand` is the term that makes it hold. A unit sitting on the
 * shelf with an unusable condition is present and active, but it is not
 * something a production can count on, so it is not `available`.
 */
export interface UnitCounts {
  active_total: number
  available: number
  unusable_on_hand: number
  in_use: number
  in_maintenance: number
  lost: number
  retired: number
}

/**
 * Path: inventory_units/{unitId}
 *
 * One physical object. `organization_id`, `inventory_item_id`, and `team_id`
 * are copies of the parent's, held here so Security Rules can authorize a write
 * without reading the parent — the same reason `maintenance_records` carries a
 * team snapshot. All three are immutable.
 */
export interface InventoryUnit {
  unit_id: string
  organization_id: string
  inventory_item_id: string
  team_id: string

  /** The label a person reads off the equipment, such as `CLAMP-017`. */
  asset_code: string
  condition: ConditionKey
  status: UnitStatus
  storage_location: string

  /** Required when retired, absent otherwise. */
  retirement_reason?: RetirementReason
  /** Present only while in use; the team currently borrowing it. */
  using_team_id?: string
  using_member_uid?: string
  checked_out_at?: Timestamp
  last_known_location?: string
  last_inspected_at?: Timestamp
  notes?: string

  /**
   * The `asset_events` entry that produced this unit's current status.
   *
   * Absent on a unit that has never moved, which includes one registered while
   * already out or already missing — that is a description of an existing
   * asset, not a transition. Present and changed on every status change, which
   * is what lets Security Rules insist a lifecycle move carries its history:
   * Rules cannot search a collection, so the unit has to name the event.
   */
  last_lifecycle_event_id?: string

  /**
   * The repair this unit is away for, while it is away.
   *
   * Current state, not history: set when the equipment leaves, removed when it
   * comes back. Rules require it exactly when `status == 'in_maintenance'`, so
   * a unit can neither be at the shop anonymously nor claim to be there after
   * returning. The unit page reads the record by id rather than searching.
   */
  current_maintenance_record_id?: string
  /**
   * A repair this unit is *intended* for, which has not started.
   *
   * Advisory only. It reserves nothing, blocks nothing, and is not a lifecycle
   * state: a unit planned for repair can still be taken out, checked in, lost,
   * or retired, and its status badge keeps saying what it actually is. The
   * pointer exists so a unit page can say "planned for maintenance" and link to
   * the plan without searching a collection for records that claim it.
   *
   * At most one open plan per unit. Rules refuse a second while the first is
   * still there, which is the simplest way to stop a teacher accidentally
   * planning the same microphone into two repairs.
   */
  planned_maintenance_record_id?: string
  /**
   * Every repair this unit has been through, oldest first.
   *
   * Append-only, one entry per visit, added at the moment the equipment leaves.
   * This is what lets one physical asset answer "has this been repaired before"
   * from its own document — the shared batch event names many units at once and
   * is not a trustworthy per-unit index.
   */
  maintenance_record_ids?: string[]

  created_by_uid: string
  created_at: Timestamp
  updated_at: Timestamp
}

/**
 * Path: inventory_items/{itemId}
 *
 * Team-scoped for editing, organization-wide for reading. `team_id` is required:
 * an item nobody owns is an item only the Admin could maintain.
 */
export interface InventoryItem {
  item_id: string
  organization_id: string
  name: string
  category: string
  team_id: string
  /**
   * Absent on every document written before serialized tracking existed, which
   * reads as `bulk`. Use `trackingModeOf()` rather than the field directly.
   */
  tracking_mode?: TrackingMode
  /** Present only for serialized items. Maintained with the units it counts. */
  unit_counts?: UnitCounts
  /**
   * For a bulk item these are what a person maintains. For a serialized item
   * they mirror the units, so everything already reading them — production
   * shortages, the dashboard, the AI context — keeps working unchanged.
   */
  quantity_total: number
  quantity_available: number
  condition_counts: ConditionCounts
  location: string
  last_inspected_at?: Timestamp
  notes?: string
  created_by_uid: string
  created_at: Timestamp
  updated_at: Timestamp
}
