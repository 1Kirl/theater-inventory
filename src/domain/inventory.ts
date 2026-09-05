import {
  UNIT_STATUSES,
  type ConditionCounts,
  type ConditionKey,
  type InventoryItem,
  type InventoryUnit,
  type TrackingMode,
  type UnitCounts,
  type UnitStatus,
} from '@/types/inventory'

/**
 * Inventory arithmetic, kept out of components so it can be tested directly and
 * so the interface and Security Rules agree on what a valid item looks like.
 */

/** Worst first. The summary is the worst state holding at least one unit. */
export const CONDITION_KEYS: readonly ConditionKey[] = [
  'unusable',
  'needs_repair',
  'fair',
  'good',
  'excellent',
]

export const CONDITION_LABELS: Record<ConditionKey, string> = {
  excellent: 'Excellent',
  good: 'Good',
  fair: 'Fair',
  needs_repair: 'Needs Repair',
  unusable: 'Unusable',
}

export const EMPTY_CONDITION_COUNTS: ConditionCounts = {
  excellent: 0,
  good: 0,
  fair: 0,
  needs_repair: 0,
  unusable: 0,
}

export function conditionCountsTotal(counts: ConditionCounts): number {
  return CONDITION_KEYS.reduce((sum, key) => sum + counts[key], 0)
}

/**
 * The representative condition: the worst bucket holding at least one unit.
 *
 * Returns null when nothing is classified, which the interface shows as
 * Unclassified rather than inventing a state the data does not support.
 */
export function conditionSummary(counts: ConditionCounts): ConditionKey | null {
  return CONDITION_KEYS.find((key) => counts[key] > 0) ?? null
}

/**
 * Units not accounted for by any condition bucket. Never negative: a count that
 * exceeds the total is a validation failure, not a negative remainder.
 */
export function unclassifiedCount(quantityTotal: number, counts: ConditionCounts): number {
  return Math.max(quantityTotal - conditionCountsTotal(counts), 0)
}

export type InventoryValidationResult = { valid: true } | { valid: false; message: string }

function isNonNegativeInteger(value: number): boolean {
  return Number.isInteger(value) && value >= 0
}

/**
 * The same invariants Security Rules enforce. Checking them here turns a
 * permission-denied into a sentence the user can act on.
 */
export function validateInventoryQuantities(params: {
  quantityTotal: number
  quantityAvailable: number
  conditionCounts: ConditionCounts
}): InventoryValidationResult {
  if (!isNonNegativeInteger(params.quantityTotal)) {
    return { valid: false, message: 'Total quantity must be a whole number of zero or more.' }
  }

  if (!isNonNegativeInteger(params.quantityAvailable)) {
    return { valid: false, message: 'Available quantity must be a whole number of zero or more.' }
  }

  if (params.quantityAvailable > params.quantityTotal) {
    return { valid: false, message: 'Available quantity cannot exceed total quantity.' }
  }

  for (const key of CONDITION_KEYS) {
    if (!isNonNegativeInteger(params.conditionCounts[key])) {
      return {
        valid: false,
        message: `${CONDITION_LABELS[key]} count must be a whole number of zero or more.`,
      }
    }
  }

  if (conditionCountsTotal(params.conditionCounts) > params.quantityTotal) {
    return {
      valid: false,
      message: 'Condition counts add up to more than the total quantity.',
    }
  }

  return { valid: true }
}

/**
 * Serialized inventory.
 *
 * Everything below derives a parent item's summary from the units beneath it.
 * The parent keeps a copy of these figures so the list, the dashboard, and
 * production shortages never read a unit — but this is where the answer is
 * actually defined, and it is what a recalculation would compute.
 */

/**
 * How an item is tracked.
 *
 * Items written before serialized tracking existed have no field, and they are
 * bulk: that is what they have always been, and reading them any other way
 * would change what the application says about data nobody touched.
 */
export function trackingModeOf(
  item: Pick<InventoryItem, 'tracking_mode'>,
): TrackingMode {
  return item.tracking_mode ?? 'bulk'
}

export function isSerialized(item: Pick<InventoryItem, 'tracking_mode'>): boolean {
  return trackingModeOf(item) === 'serialized'
}

/**
 * A bulk item's lifecycle status, defaulting the way `trackingModeOf` does.
 *
 * Absent means `available`. Every bulk item written before item lifecycle
 * existed is in exactly that position, and reading the field directly would
 * make each of those an `undefined` to handle at every call site.
 *
 * Only meaningful for a bulk item. A serialized item's units each carry their
 * own status and the item mirrors them in `unit_counts`; asking this of one
 * would invent a sixth answer next to the five its units already give.
 */
export function itemStatusOf(item: Pick<InventoryItem, 'status'>): UnitStatus {
  return item.status ?? 'available'
}

/**
 * Whether this item's own lifecycle status means anything.
 *
 * Bulk only, by construction rather than by convention: Security Rules refuse
 * `status` on a serialized item, so a serialized one can never carry a value
 * for this to read.
 */
export function tracksItemStatus(
  item: Pick<InventoryItem, 'tracking_mode'>,
): boolean {
  return trackingModeOf(item) === 'bulk'
}

export const EMPTY_UNIT_COUNTS: UnitCounts = {
  active_total: 0,
  available: 0,
  unusable_on_hand: 0,
  in_use: 0,
  in_maintenance: 0,
  lost: 0,
  retired: 0,
}

/**
 * Whether a production could actually count on this unit.
 *
 * Two conditions, and the second one is a deliberate departure from the bulk
 * model: an unusable unit is present and on the shelf, but it is not something
 * anyone can use, so it is not available. A unit merely needing repair *is*
 * available — it needs attention, not that it has stopped working.
 */
export function isUnitAvailable(
  unit: Pick<InventoryUnit, 'status' | 'condition'>,
): boolean {
  return unit.status === 'available' && unit.condition !== 'unusable'
}

/** Present in the organization, whether or not it can be used. */
export function isUnitActive(unit: Pick<InventoryUnit, 'status'>): boolean {
  return unit.status !== 'retired'
}

/**
 * The parent's summary, computed from the units.
 *
 * `unusable_on_hand` is what keeps the totals honest: without it the counts
 * would not add up, and a reader would be left to guess where the missing
 * units went.
 */
export function unitCountsFrom(
  units: readonly Pick<InventoryUnit, 'status' | 'condition'>[],
): UnitCounts {
  const counts: UnitCounts = { ...EMPTY_UNIT_COUNTS }

  for (const unit of units) {
    switch (unit.status) {
      case 'retired':
        counts.retired += 1
        continue
      case 'in_use':
        counts.in_use += 1
        break
      case 'in_maintenance':
        counts.in_maintenance += 1
        break
      case 'lost':
        counts.lost += 1
        break
      case 'available':
        if (isUnitAvailable(unit)) counts.available += 1
        else counts.unusable_on_hand += 1
        break
    }

    counts.active_total += 1
  }

  return counts
}

/**
 * Condition counts for a serialized item: the active units, by condition.
 *
 * Retired units are left out, which is what makes the total match
 * `active_total`. Every unit carries exactly one condition, so a serialized
 * item has no unclassified remainder — unlike a bulk item, where the counts are
 * a person's partial record of a quantity.
 */
export function conditionCountsFrom(
  units: readonly Pick<InventoryUnit, 'status' | 'condition'>[],
): ConditionCounts {
  const counts: ConditionCounts = { ...EMPTY_CONDITION_COUNTS }

  for (const unit of units) {
    if (isUnitActive(unit)) counts[unit.condition] += 1
  }

  return counts
}

/**
 * The parent fields a serialized item mirrors from its units.
 *
 * `quantity_total` and `quantity_available` are kept so that production
 * shortage, the dashboard, and the AI context read exactly what they read
 * before serialized tracking existed.
 */
export interface SerializedMirror {
  unit_counts: UnitCounts
  condition_counts: ConditionCounts
  quantity_total: number
  quantity_available: number
}

export function serializedMirrorFrom(
  units: readonly Pick<InventoryUnit, 'status' | 'condition'>[],
): SerializedMirror {
  const unitCounts = unitCountsFrom(units)

  return {
    unit_counts: unitCounts,
    condition_counts: conditionCountsFrom(units),
    quantity_total: unitCounts.active_total,
    quantity_available: unitCounts.available,
  }
}

/**
 * The counts add up, and none of them is negative.
 *
 * This is checkable without reading a single unit, which is why Security Rules
 * can enforce it. What no rule can check is whether the numbers match reality —
 * Rules cannot count documents. Keeping the arithmetic honest is the part that
 * is enforceable, and later phases keep the numbers honest by mutating a unit
 * and its parent inside one transaction.
 */
export function unitCountsValid(counts: UnitCounts): boolean {
  const values = [
    counts.active_total, counts.available, counts.unusable_on_hand,
    counts.in_use, counts.in_maintenance, counts.lost, counts.retired,
  ]

  if (!values.every((value) => Number.isInteger(value) && value >= 0)) return false

  return counts.active_total
    === counts.available + counts.unusable_on_hand + counts.in_use
      + counts.in_maintenance + counts.lost
}

/**
 * Which lifecycle moves are legal.
 *
 * Defined here in 11A, before anything performs them, so the later phases that
 * do have one place to agree with — and so Security Rules and the interface
 * cannot drift into permitting different things.
 *
 * `retired` is terminal. Bringing equipment back is a new unit, which is the
 * honest record: the old one really did leave the inventory.
 */
const ALLOWED_TRANSITIONS: Record<UnitStatus, readonly UnitStatus[]> = {
  available: ['in_use', 'in_maintenance', 'lost', 'retired'],
  in_use: ['available', 'in_maintenance', 'lost', 'retired'],
  in_maintenance: ['available', 'lost', 'retired'],
  lost: ['available', 'retired'],
  retired: [],
}

/**
 * The moves a person can make from the unit page, which is narrower than what
 * the model permits.
 *
 * `canTransition` describes the shape of the lifecycle. This describes what the
 * application currently knows how to *do*, and the gap between them is
 * deliberate. Anything involving maintenance is missing because a unit in
 * maintenance is half a record — the repair that explains it is the other half,
 * and creating one is a later phase. Retiring a unit that is out is missing
 * because the honest first step is to get it back or report it lost.
 */
const OFFERED_ACTIONS: Record<UnitStatus, readonly UnitStatus[]> = {
  available: ['in_use', 'lost', 'retired'],
  in_use: ['available', 'lost'],
  in_maintenance: [],
  lost: ['available', 'retired'],
  retired: [],
}

export function isOfferedTransition(from: UnitStatus, to: UnitStatus): boolean {
  return OFFERED_ACTIONS[from]?.includes(to) ?? false
}

export function offeredTransitions(from: UnitStatus): readonly UnitStatus[] {
  return OFFERED_ACTIONS[from] ?? []
}

/**
 * The moves offered on a bulk item's own lifecycle: the same ones a unit gets.
 *
 * A bulk item differs from a unit in how finely it is counted, not in how
 * equipment moves through its life, so Inventory offers it the same three
 * things — and maintenance is not among them.
 *
 * That exclusion is the whole point of routing through `OFFERED_ACTIONS`
 * rather than a table of its own. Equipment enters and leaves `in_maintenance`
 * through the maintenance workflow, which writes the repair record and the
 * status together; offering the move from Inventory would let somebody say
 * equipment is at the shop with no repair to show for it. `ALLOWED_TRANSITIONS`
 * stays broad because the maintenance service still has to make that move —
 * this is only what a person is offered.
 */
export function offeredBulkTransitions(from: UnitStatus): readonly UnitStatus[] {
  return offeredTransitions(from)
}

export function isOfferedBulkTransition(from: UnitStatus, to: UnitStatus): boolean {
  return isOfferedTransition(from, to)
}

export function canTransition(from: UnitStatus, to: UnitStatus): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false
}

export function isUnitStatus(value: string): value is UnitStatus {
  return (UNIT_STATUSES as readonly string[]).includes(value)
}
