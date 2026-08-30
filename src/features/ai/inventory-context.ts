import {
  CONDITION_KEYS, CONDITION_LABELS, conditionSummary, trackingModeOf, unclassifiedCount,
} from '@/domain/inventory'
import { isOperationallyAvailable } from '@/domain/inventory-unit'
import { formatCents, isValidCostCents } from '@/domain/money'
import { normalizeName } from '@/features/ai/ai-guards'
import type { InventoryItem, InventoryUnit } from '@/types/inventory'
import type { TheaterTeam } from '@/types/organization'

/**
 * The inventory context sent to the model, and the temporary references that
 * make it safe to send.
 *
 * Firestore is read by the application, under Security Rules, exactly as
 * before. What changes is that the records the user may already read are
 * summarized into the prompt so the model can reason about them — "nothing
 * inspected since March", "eight of the twelve are unusable" — instead of
 * guessing at filter fields.
 *
 * No document ID leaves the browser. Each record is given a request-local
 * reference, `I1`, `I2`, and the mapping back to the real item exists only for
 * the life of that one request. A reference the model returns is looked up in
 * that map; anything else is discarded, so the model cannot name a record that
 * was not supplied and cannot invent one.
 */

/**
 * How many records one request may carry.
 *
 * Measured rather than assumed: a worst-case line — long name, long category,
 * every condition bucket filled, long location — is 288 characters, roughly 72
 * tokens; a typical line is 162 characters, roughly 41. 250 records is about
 * 18,000 tokens at worst and 10,000 in practice, which is a comfortable request
 * for a Flash model and stays modest on a Spark-tier quota.
 *
 * A high school theater department with more than 250 tracked items is well
 * past the size this MVP was scoped for. Above the cap the application
 * prefilters deterministically and reports what it left out; it never quietly
 * drops records.
 */
export const MAX_CONTEXT_ITEMS = 250

/**
 * How many individual units one request may carry.
 *
 * A unit line is shorter than an item line — no condition breakdown, no
 * inspection history — at roughly 130 characters, or 33 tokens. 200 of them is
 * about 6,600 tokens on top of the item block, which keeps a mixed organization
 * comfortably inside a Flash request on a Spark-tier quota.
 *
 * Above the cap the application prefilters by the question and says how many it
 * left out, exactly as it does for items. It never silently drops equipment.
 */
export const MAX_CONTEXT_UNITS = 200

export interface InventoryContext {
  /** One compact line per record, in the order they were given references. */
  lines: string[]
  /** `I1` and the like, back to the real item. Request-local, never persisted. */
  byRef: Map<string, InventoryItem>
  totalAccessible: number
  omittedCount: number
  /** One line per individually tracked piece of equipment. */
  unitLines: string[]
  /** `U1` and the like, back to the real unit. Request-local, never persisted. */
  unitsByRef: Map<string, InventoryUnit>
  totalUnitsAccessible: number
  omittedUnitCount: number
}

export const EMPTY_CONTEXT: InventoryContext = {
  lines: [],
  byRef: new Map(),
  totalAccessible: 0,
  omittedCount: 0,
  unitLines: [],
  unitsByRef: new Map(),
  totalUnitsAccessible: 0,
  omittedUnitCount: 0,
}

function teamNameOf(item: InventoryItem, teams: readonly TheaterTeam[]): string {
  return teams.find((team) => team.team_id === item.team_id)?.name ?? 'unassigned team'
}

function conditionPhrase(item: InventoryItem): string {
  const parts = CONDITION_KEYS
    .filter((key) => item.condition_counts[key] > 0)
    .map((key) => `${CONDITION_LABELS[key].toLowerCase()} ${item.condition_counts[key]}`)

  const unclassified = unclassifiedCount(item.quantity_total, item.condition_counts)
  if (unclassified > 0) parts.push(`unclassified ${unclassified}`)

  if (parts.length === 0) return 'condition unrecorded'

  const summary = conditionSummary(item.condition_counts)
  const overall = summary ? CONDITION_LABELS[summary].toLowerCase() : 'unclassified'
  return `condition ${overall} (${parts.join(', ')})`
}

/**
 * `last_inspected: null` is written out in full rather than omitted.
 *
 * "Never inspected" and "no inspection history" are things people ask about, and
 * a missing line reads as missing data rather than as a fact about the item.
 */
function inspectionPhrase(item: InventoryItem): string {
  if (!item.last_inspected_at) return 'last_inspected: null (never inspected)'

  const date = item.last_inspected_at.toDate()
  const key = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-')

  return `last_inspected: ${key}`
}

/**
 * What one item's numbers actually describe.
 *
 * A bulk item is a quantity somebody maintains by hand. A serialized item is a
 * catalog entry whose numbers are counted from individual equipment listed
 * separately — so its line says so, and points at the unit block rather than
 * inviting the model to describe ten microphones as if they were one.
 */
function trackingPhrase(item: InventoryItem): string {
  if (trackingModeOf(item) !== 'serialized') return 'tracking bulk quantity'

  const counts = item.unit_counts
  if (!counts) return 'tracking individual units'

  const parts = [
    `available ${counts.available}`,
    `in use ${counts.in_use}`,
    `in maintenance ${counts.in_maintenance}`,
    `lost ${counts.lost}`,
    `unusable on hand ${counts.unusable_on_hand}`,
  ]
  // Retired equipment is out of the active inventory, so it is named only when
  // there is some — and never folded into the active total.
  if (counts.retired > 0) parts.push(`retired ${counts.retired} (not active)`)

  return `tracking individual units (${parts.join(', ')})`
}

/** Stored planning cost, or an explicit statement that nobody has recorded one. */
function costPhrase(item: InventoryItem): string {
  return isValidCostCents(item.unit_cost_cents)
    ? `estimated unit cost ${formatCents(item.unit_cost_cents)}`
    : 'estimated unit cost unknown'
}

export function serializeItem(
  ref: string,
  item: InventoryItem,
  teams: readonly TheaterTeam[],
): string {
  const serialized = trackingModeOf(item) === 'serialized'

  return [
    ref,
    item.name,
    item.category,
    `team ${teamNameOf(item, teams)}`,
    trackingPhrase(item),
    serialized
      ? `active total ${item.quantity_total}, available ${item.quantity_available}`
      : `total ${item.quantity_total}, available ${item.quantity_available}`,
    conditionPhrase(item),
    `location ${item.location}`,
    costPhrase(item),
    inspectionPhrase(item),
  ].join(' | ')
}

/**
 * One physical piece of equipment.
 *
 * This is the authoritative record for serialized equipment: where it is, what
 * state it is in, and who has it. The parent item's numbers are a summary of
 * these, never a description of any one of them.
 */
export function serializeUnit(
  ref: string,
  unit: InventoryUnit,
  item: InventoryItem | undefined,
  teams: readonly TheaterTeam[],
): string {
  const teamName = teams.find((team) => team.team_id === unit.team_id)?.name ?? 'unassigned team'

  const parts = [
    ref,
    `asset code ${unit.asset_code}`,
    item ? item.name : 'unknown item',
    `owned by team ${teamName}`,
    `status ${unit.status}`,
    `condition ${unit.condition}`,
    // Availability is status and condition together, which is the product's
    // rule and not something the model should re-derive: equipment that needs
    // repair is still on the shelf, and unusable equipment is not.
    isOperationallyAvailable(unit) ? 'available yes' : 'available no',
    `location ${unit.storage_location}`,
  ]

  if (unit.status === 'in_use' && unit.using_team_id) {
    const using = teams.find((team) => team.team_id === unit.using_team_id)?.name ?? 'unknown team'
    parts.push(`checked out to team ${using}`)
  }

  // The two maintenance facts are kept apart on purpose. A plan is an
  // intention and the equipment is still where it was; a current repair means
  // it has physically left.
  if (unit.status === 'in_maintenance' && unit.current_maintenance_record_id) {
    parts.push('currently away for repair')
  }
  if (unit.planned_maintenance_record_id) {
    parts.push('planned maintenance scheduled (advisory, not yet away)')
  }
  const history = unit.maintenance_record_ids?.length ?? 0
  if (history > 0) parts.push(`past repairs ${history}`)

  if (item) parts.push(`part of ${item.category}`)

  return parts.join(' | ')
}

/**
 * Deterministic prefilter, used only when the accessible inventory exceeds the
 * cap.
 *
 * Words from the user's question are matched against name, category, and
 * location. Records that match come first, so an over-cap organization still
 * gets the records the question is about; the rest keep their existing order.
 * Nothing here decides what the answer is — it decides what the model gets to
 * look at, and the user is told how many were left out.
 */
export function prioritizeForQuery(
  items: readonly InventoryItem[],
  query: string,
): InventoryItem[] {
  const words = normalizeName(query).split(' ').filter((word) => word.length >= 3)
  if (words.length === 0) return [...items]

  const matches: InventoryItem[] = []
  const rest: InventoryItem[] = []

  for (const item of items) {
    const haystack = normalizeName(`${item.name} ${item.category} ${item.location}`)
    if (words.some((word) => haystack.includes(word))) matches.push(item)
    else rest.push(item)
  }

  return [...matches, ...rest]
}

/**
 * What a question is operationally about, beyond the words in it.
 *
 * Matching text alone is not enough once an organization has more equipment
 * than one request can carry. "Do we have anything with planned maintenance?"
 * contains no asset code, no item name, and no location — and a unit with a
 * repair planned is usually sitting on the shelf with status `available`, so
 * even the word "maintenance" does not match it. Ranking by text would push
 * exactly the equipment the question is about to the bottom and then cut it.
 *
 * Each intent names a predicate over the unit itself, so the equipment that
 * answers the question survives the cap whatever it happens to be called.
 */
const UNIT_INTENTS: { phrases: readonly string[]; holds: (unit: InventoryUnit) => boolean }[] = [
  {
    phrases: ['planned maintenance', 'scheduled maintenance', 'planned repair',
      'upcoming maintenance', 'maintenance planned', 'scheduled for maintenance'],
    holds: (unit) => Boolean(unit.planned_maintenance_record_id),
  },
  {
    phrases: ['in maintenance', 'being repaired', 'out for repair', 'away for repair',
      'in the shop', 'in service', 'under repair'],
    holds: (unit) => unit.status === 'in_maintenance',
  },
  { phrases: ['lost', 'missing', 'cannot find', "can't find"], holds: (u) => u.status === 'lost' },
  { phrases: ['retired', 'disposed', 'decommissioned'], holds: (u) => u.status === 'retired' },
  {
    phrases: ['checked out', 'check out', 'in use', 'borrowed', 'who has'],
    holds: (unit) => unit.status === 'in_use',
  },
  { phrases: ['available', 'free', 'on the shelf'], holds: isOperationallyAvailable },
  { phrases: ['needs repair', 'need repair', 'broken', 'damaged'], holds: (u) => u.condition === 'needs_repair' },
  { phrases: ['unusable', 'unserviceable', 'write off', 'write-off'], holds: (u) => u.condition === 'unusable' },
]

/**
 * The catch-all, used only when nothing more specific matched.
 *
 * A bare "anything to do with repair" could mean either kind, so both are kept.
 * But "planned maintenance" contains the word "maintenance", and letting this
 * fire alongside the specific rule would fill the request with every unit
 * sitting in a repair shop — crowding out the equipment actually asked about.
 */
const BROAD_MAINTENANCE = {
  phrases: ['maintenance', 'repair'],
  holds: (unit: InventoryUnit) => unit.status === 'in_maintenance'
    || Boolean(unit.planned_maintenance_record_id),
}

/** Which predicates a question asks about. Empty when it asks about none. */
export function unitIntentsOf(query: string): ((unit: InventoryUnit) => boolean)[] {
  const text = normalizeName(query)

  const specific = UNIT_INTENTS
    .filter((intent) => intent.phrases.some((phrase) => text.includes(phrase)))
    .map((intent) => intent.holds)

  if (specific.length > 0) return specific

  return BROAD_MAINTENANCE.phrases.some((phrase) => text.includes(phrase))
    ? [BROAD_MAINTENANCE.holds]
    : []
}

/**
 * The same idea for units, with the asset code carrying most of the weight.
 *
 * "Where is MIC-017?" is the question this exists for, and a two-character
 * minimum lets a code fragment through where the three-character rule used for
 * prose would drop it. Equipment matching the question's operational intent is
 * ranked above a text match, because a question about planned maintenance is
 * answered by the equipment that has some, not by whatever happens to share a
 * word with it.
 */
export function prioritizeUnitsForQuery(
  units: readonly InventoryUnit[],
  query: string,
  itemsById: ReadonlyMap<string, InventoryItem>,
): InventoryUnit[] {
  const intents = unitIntentsOf(query)
  const words = normalizeName(query).split(' ').filter((word) => word.length >= 2)
  if (intents.length === 0 && words.length === 0) return [...units]

  const byIntent: InventoryUnit[] = []
  const byText: InventoryUnit[] = []
  const rest: InventoryUnit[] = []

  for (const unit of units) {
    if (intents.some((holds) => holds(unit))) {
      byIntent.push(unit)
      continue
    }

    const item = itemsById.get(unit.inventory_item_id)
    const haystack = normalizeName([
      unit.asset_code, unit.storage_location, unit.status, unit.condition, item?.name ?? '',
    ].join(' '))

    if (words.some((word) => haystack.includes(word))) byText.push(unit)
    else rest.push(unit)
  }

  return [...byIntent, ...byText, ...rest]
}

export function buildInventoryContext(params: {
  items: readonly InventoryItem[]
  teams: readonly TheaterTeam[]
  /** Individually tracked equipment. Absent for an organization with none. */
  units?: readonly InventoryUnit[] | undefined
  /** When present, decides which records survive the cap. */
  query?: string
  cap?: number
  unitCap?: number
}): InventoryContext {
  const cap = params.cap ?? MAX_CONTEXT_ITEMS
  const total = params.items.length

  const ordered = total > cap && params.query
    ? prioritizeForQuery(params.items, params.query)
    : [...params.items]

  const included = ordered.slice(0, cap)
  const byRef = new Map<string, InventoryItem>()
  const lines: string[] = []

  included.forEach((item, index) => {
    const ref = `I${index + 1}`
    byRef.set(ref, item)
    lines.push(serializeItem(ref, item, params.teams))
  })

  const unitCap = params.unitCap ?? MAX_CONTEXT_UNITS
  const allUnits = params.units ?? []
  const itemsById = new Map(params.items.map((item) => [item.item_id, item]))

  const orderedUnits = allUnits.length > unitCap && params.query
    ? prioritizeUnitsForQuery(allUnits, params.query, itemsById)
    : [...allUnits]

  const includedUnits = orderedUnits.slice(0, unitCap)
  const unitsByRef = new Map<string, InventoryUnit>()
  const unitLines: string[] = []

  includedUnits.forEach((unit, index) => {
    const ref = `U${index + 1}`
    unitsByRef.set(ref, unit)
    unitLines.push(serializeUnit(ref, unit, itemsById.get(unit.inventory_item_id), params.teams))
  })

  return {
    lines,
    byRef,
    totalAccessible: total,
    omittedCount: Math.max(total - included.length, 0),
    unitLines,
    unitsByRef,
    totalUnitsAccessible: allUnits.length,
    omittedUnitCount: Math.max(allUnits.length - includedUnits.length, 0),
  }
}

export interface ResolvedRefs {
  items: InventoryItem[]
  /** Individual equipment the answer refers to. */
  units: InventoryUnit[]
  /** References the model returned that were never supplied. */
  unknown: string[]
  /** References the model returned more than once, listed once each. */
  duplicates: string[]
}

/**
 * Turn references back into records, discarding anything not supplied.
 *
 * This is the check that makes the whole arrangement safe. A model that invents
 * `I99`, echoes a Firestore ID, or repeats `I3` four times produces nothing
 * extra: what the user sees is only ever records the application itself put
 * into the request.
 */
export function resolveRefs(
  refs: readonly string[],
  context: InventoryContext,
): ResolvedRefs {
  const items: InventoryItem[] = []
  const units: InventoryUnit[] = []
  const unknown: string[] = []
  const duplicates: string[] = []
  const seen = new Set<string>()

  for (const raw of refs) {
    const ref = raw.trim().toUpperCase()
    const item = context.byRef.get(ref)
    const unit = context.unitsByRef.get(ref)

    if (!item && !unit) {
      unknown.push(raw)
      continue
    }
    if (seen.has(ref)) {
      if (!duplicates.includes(ref)) duplicates.push(ref)
      continue
    }

    seen.add(ref)
    if (item) items.push(item)
    if (unit) units.push(unit)
  }

  return { items, units, unknown, duplicates }
}

/** The context block as it appears in the prompt. */
export function contextBlock(context: InventoryContext): string {
  if (context.lines.length === 0 && context.unitLines.length === 0) {
    return 'INVENTORY: none supplied. Do not state anything about what this organization owns.'
  }

  const header = context.omittedCount > 0
    ? `INVENTORY: ${context.lines.length} of ${context.totalAccessible} records the user may read.`
      + ` ${context.omittedCount} were not included, so do not claim the list is complete.`
    : `INVENTORY: all ${context.lines.length} records the user may read.`

  const blocks = [header, '<<<INVENTORY_DATA', ...context.lines, 'INVENTORY_DATA>>>']

  if (context.unitLines.length > 0) {
    const unitHeader = context.omittedUnitCount > 0
      ? `EQUIPMENT: ${context.unitLines.length} of ${context.totalUnitsAccessible} individually`
        + ` tracked pieces. ${context.omittedUnitCount} were not included, so do not claim the`
        + ' list is complete.'
      : `EQUIPMENT: all ${context.unitLines.length} individually tracked pieces.`

    blocks.push(
      '',
      `${unitHeader} Each line is one physical piece of equipment and is the`
      + ' authoritative record for it. Where an item above is tracked as individual units, these'
      + ' lines say where each one actually is; the item line only summarizes them.',
      '<<<EQUIPMENT_DATA',
      ...context.unitLines,
      'EQUIPMENT_DATA>>>',
    )
  }

  return blocks.join('\n')
}
