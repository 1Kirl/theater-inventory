import {
  EMPTY_CONDITION_COUNTS, EMPTY_UNIT_COUNTS, isUnitAvailable,
} from '@/domain/inventory'
import { openRecords } from '@/domain/maintenance'
import type {
  ConditionCounts, ConditionKey, InventoryItem, InventoryUnit, UnitCounts, UnitStatus,
} from '@/types/inventory'
import type { MaintenanceRecord } from '@/types/maintenance'
import type { InventoryItemInput } from '@/domain/inventory-payloads'

/**
 * The arithmetic of keeping a serialized item's parent in step with its units.
 *
 * Every function here is pure and takes the parent's current mirrors, so a
 * transaction can read the parent, compute the next mirrors, and write both in
 * one step. Nothing here talks to Firestore.
 */

/** The four parent fields a serialized item keeps in step with its units. */
export interface ItemMirrors {
  unit_counts: UnitCounts
  condition_counts: ConditionCounts
  quantity_total: number
  quantity_available: number
}

export const EMPTY_MIRRORS: ItemMirrors = {
  unit_counts: { ...EMPTY_UNIT_COUNTS },
  condition_counts: { ...EMPTY_CONDITION_COUNTS },
  quantity_total: 0,
  quantity_available: 0,
}

/**
 * The parent item, with its mirrors replaced — as an update input.
 *
 * A mirror update is a whole-document write, so every field the parent owns has
 * to be listed here or it is deleted. Three services used to keep their own
 * copy of this object and all three omitted `unitCostCents`, which meant adding
 * a single unit to a serialized item silently erased its estimated cost. The
 * item still reported a cost until the first unit existed, which is exactly the
 * moment the cost starts to matter.
 *
 * One copy, in the module that already owns the mirror arithmetic, so the next
 * field added to `InventoryItemInput` has one place to be remembered rather
 * than three. Nothing here decides anything: the mirrors are computed by the
 * functions below and the rest is carried through untouched.
 */
export function serializedMirrorInput(
  item: InventoryItem,
  mirrors: ItemMirrors,
): InventoryItemInput {
  return {
    name: item.name,
    category: item.category,
    teamId: item.team_id,
    trackingMode: 'serialized',
    unitCounts: mirrors.unit_counts,
    quantityTotal: mirrors.quantity_total,
    quantityAvailable: mirrors.quantity_available,
    conditionCounts: mirrors.condition_counts,
    location: item.location,
    // Presence, not truthiness. A known zero is a decision somebody recorded and
    // must survive; `undefined` stays undefined and remains unknown.
    unitCostCents: item.unit_cost_cents ?? null,
    lastInspectedAt: item.last_inspected_at ?? null,
    notes: item.notes,
  }
}

/** Read the mirrors off an item, filling in what a bulk item never had. */
export function mirrorsOf(item: Pick<InventoryItem, 'unit_counts' | 'condition_counts'>): ItemMirrors {
  const counts = item.unit_counts ?? EMPTY_UNIT_COUNTS

  return {
    unit_counts: { ...counts },
    condition_counts: { ...item.condition_counts },
    quantity_total: counts.active_total,
    quantity_available: counts.available,
  }
}

/**
 * Which bucket a unit occupies, given both of its axes.
 *
 * `available` splits in two: a unit on the shelf is either something a
 * production can count on or an unusable object taking up space.
 */
export type CountBucket = 'available' | 'unusable_on_hand' | 'in_use' | 'in_maintenance' | 'lost'

export function bucketOf(unit: Pick<InventoryUnit, 'status' | 'condition'>): CountBucket | null {
  if (unit.status === 'retired') return null
  if (unit.status === 'available') return isUnitAvailable(unit) ? 'available' : 'unusable_on_hand'
  return unit.status
}

function recomputed(counts: UnitCounts, conditions: ConditionCounts): ItemMirrors {
  const unitCounts: UnitCounts = {
    ...counts,
    active_total: counts.available + counts.unusable_on_hand + counts.in_use
      + counts.in_maintenance + counts.lost,
  }

  return {
    unit_counts: unitCounts,
    condition_counts: { ...conditions },
    quantity_total: unitCounts.active_total,
    quantity_available: unitCounts.available,
  }
}

/**
 * The parent after a unit is added.
 *
 * An unusable unit raises the total without raising what is available, which is
 * the whole reason `unusable_on_hand` exists.
 */
export function withUnitAdded(
  mirrors: ItemMirrors,
  unit: Pick<InventoryUnit, 'status' | 'condition'>,
): ItemMirrors {
  const bucket = bucketOf(unit)
  const counts = { ...mirrors.unit_counts }
  const conditions = { ...mirrors.condition_counts }

  if (bucket === null) {
    counts.retired += 1
    return recomputed(counts, conditions)
  }

  counts[bucket] += 1
  conditions[unit.condition] += 1

  return recomputed(counts, conditions)
}

/** The parent after several units are added, in one step. */
export function withUnitsAdded(
  mirrors: ItemMirrors,
  units: readonly Pick<InventoryUnit, 'status' | 'condition'>[],
): ItemMirrors {
  return units.reduce(withUnitAdded, mirrors)
}

/**
 * The parent after a unit's condition changes.
 *
 * The condition buckets always move. Whether the availability buckets move
 * depends on whether the change crossed the unusable line while the unit was on
 * the shelf: fair to good changes nothing about what a production can count on,
 * fair to unusable changes it entirely.
 */
export function withConditionChanged(
  mirrors: ItemMirrors,
  change: { status: UnitStatus; from: ConditionKey; to: ConditionKey },
): ItemMirrors {
  if (change.from === change.to) return mirrors

  const counts = { ...mirrors.unit_counts }
  const conditions = { ...mirrors.condition_counts }

  if (change.status !== 'retired') {
    conditions[change.from] -= 1
    conditions[change.to] += 1
  }

  if (change.status === 'available') {
    const before = bucketOf({ status: 'available', condition: change.from }) as CountBucket
    const after = bucketOf({ status: 'available', condition: change.to }) as CountBucket

    if (before !== after) {
      counts[before] -= 1
      counts[after] += 1
    }
  }

  return recomputed(counts, conditions)
}

/**
 * Asset codes for a run of units: `CLAMP-001`, `CLAMP-002`, and so on.
 *
 * Zero-padded to the width of the highest number, so a hundred clamps sort
 * correctly in a list and read consistently on a label.
 */
export const MAX_BULK_UNITS = 200

export function padWidthFor(start: number, count: number): number {
  return Math.max(String(start + count - 1).length, 3)
}

export function generateAssetCodes(params: {
  prefix: string
  start: number
  count: number
}): string[] {
  const prefix = params.prefix.trim()
  const width = padWidthFor(params.start, params.count)

  return Array.from({ length: params.count }, (_, index) => {
    const number = String(params.start + index).padStart(width, '0')
    return prefix.length > 0 ? `${prefix}-${number}` : number
  })
}

export type BulkGenerationResult =
  | { valid: true; codes: string[]; duplicates: string[] }
  | { valid: false; message: string }

/**
 * Validate a bulk request and report which codes are already taken.
 *
 * A duplicate is a warning rather than a refusal: `asset_code` is a label a
 * person reads, not the identity of the record, and two clamps sharing one is
 * untidy rather than broken. The caller decides whether to go ahead.
 */
export function planBulkGeneration(params: {
  prefix: string
  start: number
  count: number
  existingCodes: readonly string[]
}): BulkGenerationResult {
  if (!Number.isInteger(params.count) || params.count < 1) {
    return { valid: false, message: 'Choose how many to create — at least one.' }
  }

  if (params.count > MAX_BULK_UNITS) {
    return {
      valid: false,
      message: `Create at most ${MAX_BULK_UNITS} at a time. Split a larger batch into runs.`,
    }
  }

  if (!Number.isInteger(params.start) || params.start < 0) {
    return { valid: false, message: 'The starting number must be zero or more.' }
  }

  const codes = generateAssetCodes(params)
  const taken = new Set(params.existingCodes.map((code) => code.trim().toLowerCase()))
  const duplicates = codes.filter((code) => taken.has(code.toLowerCase()))

  return { valid: true, codes, duplicates }
}

/**
 * Promoting a bulk item to serialized.
 *
 * A bulk item records less than a serialized one needs, and the difference is
 * made up by the person doing the conversion rather than by this module.
 *
 * Two things are genuinely unknown. The aggregate does not say *why* some units
 * were unavailable — twelve total and eight available says nothing about where
 * the other four are — so every draft starts `available`. And a bulk item may
 * carry unclassified quantity, because `sum(condition_counts) <= quantity_total`
 * is legal there; a serialized item has no such state, since every unit holds
 * exactly one condition. So an unclassified draft starts at `null` and stays
 * unconvertible until someone says what it is.
 */
export interface PromotionDraft {
  assetCode: string
  /** `null` until the user classifies a unit the aggregate never accounted for. */
  condition: ConditionKey | null
  status: UnitStatus
  storageLocation: string
  /**
   * The crew this unit belongs to. Defaults to the bulk item's team, which is
   * real information rather than a guess, and is changeable per unit during
   * review — a shelf of clamps often ends up split between crews.
   */
  owningTeamId: string
  /** Required when the status is `in_use`. Never inferred. */
  usingTeamId?: string | null
}

/** A draft that is ready to be written: nothing left for the user to decide. */
export type ResolvedPromotionDraft = Omit<PromotionDraft, 'condition'> & {
  condition: ConditionKey
}

/**
 * The statuses a conversion may assign.
 *
 * Retiring active stock makes no sense, and `in_maintenance` is deliberately
 * absent. A unit in maintenance is only half a record: the other half is a
 * maintenance record naming the provider, the date it went out, and when it is
 * expected back, and the transition into that status is what creates it. A
 * promotion that set the status alone would produce a unit stuck in maintenance
 * with no repair to return from and no history explaining it.
 *
 * So equipment that is genuinely away for repair cannot be described by this
 * conversion yet. Inventing a placeholder repair, or parking it in some other
 * status, would both be worse than saying so. Unit-level maintenance arrives in
 * a later phase and brings the correct path with it.
 */
export const PROMOTION_STATUSES: readonly UnitStatus[] = [
  'available',
  'in_use',
  'lost',
]

const CONDITION_ORDER: readonly ConditionKey[] = [
  'excellent', 'good', 'fair', 'needs_repair', 'unusable',
]

/**
 * Draft units for a conversion, one per unit of the old total.
 *
 * The recorded condition counts are distributed across the drafts as a
 * convenience. Whatever they do not account for is left `null` — deliberately,
 * because inventing a condition here would put a number in the serialized
 * summary that nobody ever observed.
 */
export function buildPromotionDrafts(params: {
  item: Pick<InventoryItem, 'quantity_total' | 'condition_counts' | 'location' | 'team_id'>
  prefix: string
  start: number
  storageLocation?: string
}): PromotionDraft[] {
  const total = Math.max(params.item.quantity_total, 0)
  const codes = generateAssetCodes({ prefix: params.prefix, start: params.start, count: total })
  const location = params.storageLocation?.trim() || params.item.location

  const conditions: ConditionKey[] = []
  for (const key of CONDITION_ORDER) {
    for (let index = 0; index < params.item.condition_counts[key]; index += 1) {
      conditions.push(key)
    }
  }

  return codes.map((assetCode, index) => ({
    assetCode,
    // Undefined past the classified count: the aggregate never said.
    condition: conditions[index] ?? null,
    status: 'available' as UnitStatus,
    storageLocation: location,
    owningTeamId: params.item.team_id,
  }))
}

/** How many drafts the user still has to classify. */
export function unclassifiedDraftCount(drafts: readonly PromotionDraft[]): number {
  return drafts.filter((draft) => draft.condition === null).length
}

/** Drafts whose status says they are out but which name no borrowing team. */
export function draftsMissingUsingTeam(drafts: readonly PromotionDraft[]): number {
  return drafts.filter(
    (draft) => draft.status === 'in_use' && (draft.usingTeamId ?? '').trim().length === 0,
  ).length
}

export interface PromotionOutcome {
  /** What the bulk item said was available. */
  previousAvailable: number
  /** What the drafts will make available once converted. */
  nextAvailable: number
  changed: boolean
  mirrors: ItemMirrors
}

/**
 * What a conversion will do to the numbers, before it does it.
 *
 * Availability can move for two reasons, and both are worth showing: units the
 * reviewer marked as out, and unusable units that the aggregate model counted
 * as available but the serialized one does not.
 */
export function promotionOutcome(params: {
  item: Pick<InventoryItem, 'quantity_available'>
  drafts: readonly ResolvedPromotionDraft[]
}): PromotionOutcome {
  const mirrors = withUnitsAdded(EMPTY_MIRRORS, params.drafts)

  return {
    previousAvailable: params.item.quantity_available,
    nextAvailable: mirrors.unit_counts.available,
    changed: mirrors.unit_counts.available !== params.item.quantity_available,
    mirrors,
  }
}

/**
 * Why an item cannot be converted while repairs are open.
 *
 * A bulk repair is recorded as a quantity — four of the twenty-four clamps went
 * out — and says nothing about *which* four. Serialized maintenance attaches a
 * repair to named units, and that does not exist yet, so there is no honest way
 * to carry an open repair across the conversion. The only alternatives would be
 * to drop it, or to make the user file those four units as available, in use, or
 * lost, all three of which would be false.
 *
 * So the conversion waits until the repair is closed. Returned and cancelled
 * repairs are history and block nothing; they stay as the aggregate records they
 * always were, and no attempt is made to attach them to the new units.
 */
export interface PromotionMaintenanceBlock {
  openRecordCount: number
  /** Quantity those open repairs account for, which is all a bulk record says. */
  unitsInMaintenance: number
}

export function promotionMaintenanceBlock(
  records: readonly Pick<MaintenanceRecord, 'status' | 'quantity_sent'>[],
): PromotionMaintenanceBlock | null {
  const open = openRecords(records)
  if (open.length === 0) return null

  return {
    openRecordCount: open.length,
    unitsInMaintenance: open.reduce((sum, record) => sum + record.quantity_sent, 0),
  }
}

export type PromotionValidation =
  /** The drafts carry no unresolved decisions and are safe to write. */
  | { valid: true; drafts: ResolvedPromotionDraft[] }
  | { valid: false; message: string }

/**
 * Everything that must be true before a conversion may be written.
 *
 * `teamIds` are the organization's real teams. A borrowing team is checked
 * against them here because Rules cannot: verifying it would cost an access
 * call per unit, which is exactly the budget a batch of two hundred cannot
 * afford. What Rules do enforce is that an `in_use` unit names *some* team, so
 * the shape is guaranteed even though the membership check is not.
 */
export function validatePromotion(params: {
  item: Pick<InventoryItem, 'quantity_total'>
  drafts: readonly PromotionDraft[]
  teamIds: readonly string[]
}): PromotionValidation {
  if (params.drafts.length === 0) {
    return { valid: false, message: 'There is nothing to convert: this item has no quantity.' }
  }

  if (params.drafts.length !== params.item.quantity_total) {
    return {
      valid: false,
      message: `Create one unit for each of the ${params.item.quantity_total} recorded.`,
    }
  }

  if (params.drafts.length > MAX_BULK_UNITS) {
    return {
      valid: false,
      message: `Converting more than ${MAX_BULK_UNITS} units at once is not supported.`,
    }
  }

  const unclassified = unclassifiedDraftCount(params.drafts)
  if (unclassified > 0) {
    return {
      valid: false,
      message: `${unclassified} unit${unclassified === 1 ? ' does' : 's do'} not have an existing `
        + 'condition classification. Assign a condition before converting this item.',
    }
  }

  for (const draft of params.drafts) {
    if (draft.assetCode.trim().length === 0) {
      return { valid: false, message: 'Every unit needs an asset code.' }
    }
    if (!PROMOTION_STATUSES.includes(draft.status)) {
      return {
        valid: false,
        message: 'A conversion may only start units as available, in use, or lost.',
      }
    }
    if (!params.teamIds.includes(draft.owningTeamId)) {
      return {
        valid: false,
        message: 'A unit names an owning team that does not belong to this organization.',
      }
    }
    if (draft.status === 'in_use') {
      const usingTeamId = (draft.usingTeamId ?? '').trim()
      if (usingTeamId.length === 0) {
        return {
          valid: false,
          message: 'A unit that is in use has to say which team has it. Choose one for every '
            + 'unit you marked in use.',
        }
      }
      if (!params.teamIds.includes(usingTeamId)) {
        return {
          valid: false,
          message: 'A unit names a team that does not belong to this organization.',
        }
      }
    }
  }

  const codes = params.drafts.map((draft) => draft.assetCode.trim().toLowerCase())
  if (new Set(codes).size !== codes.length) {
    return { valid: false, message: 'Two units would share an asset code. Make each one distinct.' }
  }

  // Every draft has been proven to carry a condition, which is what the
  // resolved type promises.
  return { valid: true, drafts: params.drafts as ResolvedPromotionDraft[] }
}

/**
 * What a lifecycle move does to the parent's numbers.
 *
 * Every move is the same shape underneath: the unit leaves one bucket and
 * enters another, and `bucketOf` already knows which bucket a unit belongs to
 * from its status and condition together. So rather than five hand-written sets
 * of increments — which is where an arithmetic bug would hide — this computes
 * the before and after buckets and moves one unit between them.
 *
 * That is also why condition matters here at all. An unusable unit on the shelf
 * sits in `unusable_on_hand` rather than `available`, so marking it lost moves
 * it out of a bucket that was never counted as availability, and the available
 * quantity does not change. The same rule read forwards explains why a found
 * unusable unit does not become available again.
 */
export function withStatusChanged(
  mirrors: ItemMirrors,
  change: { condition: ConditionKey; from: UnitStatus; to: UnitStatus },
): ItemMirrors {
  if (change.from === change.to) return mirrors

  const before = bucketOf({ status: change.from, condition: change.condition })
  const after = bucketOf({ status: change.to, condition: change.condition })

  const unitCounts = { ...mirrors.unit_counts }
  const conditionCounts = { ...mirrors.condition_counts }

  if (before !== null) unitCounts[before] -= 1
  if (after !== null) unitCounts[after] += 1

  // Retirement is the only move that changes what the active totals cover: a
  // retired unit leaves the condition breakdown and the item's quantity, and
  // is counted separately for the rest of its life.
  if (change.to === 'retired') {
    unitCounts.retired += 1
    unitCounts.active_total -= 1
    conditionCounts[change.condition] -= 1
  }
  if (change.from === 'retired') {
    unitCounts.retired -= 1
    unitCounts.active_total += 1
    conditionCounts[change.condition] += 1
  }

  return {
    unit_counts: unitCounts,
    condition_counts: conditionCounts,
    quantity_total: unitCounts.active_total,
    quantity_available: unitCounts.available,
  }
}

/** A unit is operationally available: on the shelf and fit to use. */
export function isOperationallyAvailable(
  unit: Pick<InventoryUnit, 'status' | 'condition'>,
): boolean {
  return bucketOf(unit) === 'available'
}
