import { CONDITION_KEYS, CONDITION_LABELS, conditionSummary, unclassifiedCount } from '@/domain/inventory'
import { normalizeName } from '@/features/ai/ai-guards'
import type { InventoryItem } from '@/types/inventory'
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

export interface InventoryContext {
  /** One compact line per record, in the order they were given references. */
  lines: string[]
  /** `I1` and the like, back to the real item. Request-local, never persisted. */
  byRef: Map<string, InventoryItem>
  totalAccessible: number
  omittedCount: number
}

export const EMPTY_CONTEXT: InventoryContext = {
  lines: [],
  byRef: new Map(),
  totalAccessible: 0,
  omittedCount: 0,
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

export function serializeItem(
  ref: string,
  item: InventoryItem,
  teams: readonly TheaterTeam[],
): string {
  return [
    ref,
    item.name,
    item.category,
    `team ${teamNameOf(item, teams)}`,
    `total ${item.quantity_total}, available ${item.quantity_available}`,
    conditionPhrase(item),
    `location ${item.location}`,
    inspectionPhrase(item),
  ].join(' | ')
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

export function buildInventoryContext(params: {
  items: readonly InventoryItem[]
  teams: readonly TheaterTeam[]
  /** When present, decides which records survive the cap. */
  query?: string
  cap?: number
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

  return {
    lines,
    byRef,
    totalAccessible: total,
    omittedCount: Math.max(total - included.length, 0),
  }
}

export interface ResolvedRefs {
  items: InventoryItem[]
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
  const unknown: string[] = []
  const duplicates: string[] = []
  const seen = new Set<string>()

  for (const raw of refs) {
    const ref = raw.trim().toUpperCase()
    const item = context.byRef.get(ref)

    if (!item) {
      unknown.push(raw)
      continue
    }
    if (seen.has(ref)) {
      if (!duplicates.includes(ref)) duplicates.push(ref)
      continue
    }

    seen.add(ref)
    items.push(item)
  }

  return { items, unknown, duplicates }
}

/** The context block as it appears in the prompt. */
export function contextBlock(context: InventoryContext): string {
  if (context.lines.length === 0) {
    return 'INVENTORY: none supplied. Do not state anything about what this organization owns.'
  }

  const header = context.omittedCount > 0
    ? `INVENTORY: ${context.lines.length} of ${context.totalAccessible} records the user may read.`
      + ` ${context.omittedCount} were not included, so do not claim the list is complete.`
    : `INVENTORY: all ${context.lines.length} records the user may read.`

  return [header, '<<<INVENTORY_DATA', ...context.lines, 'INVENTORY_DATA>>>'].join('\n')
}
