import { z } from 'zod'
import { CONDITION_KEYS, CONDITION_LABELS, conditionSummary } from '@/domain/inventory'
import { EMPTY_FILTERS, filterInventoryItems, type InventoryFilters } from '@/features/inventory/inventory-view'
import { looksLikeDocumentId, normalizeName } from '@/features/ai/ai-guards'
import { resolveRefs, type InventoryContext } from '@/features/ai/inventory-context'
import { INVENTORY_CATEGORIES, type ConditionKey, type InventoryItem } from '@/types/inventory'
import type { TheaterTeam } from '@/types/organization'

/**
 * AI Smart Search: a question about the inventory, answered from the inventory.
 *
 * The model is given a compact view of the records the user may already read,
 * each under a request-local reference, and answers in two parts: a sentence
 * for the person, and the references it is talking about. This module turns
 * those references back into real records.
 *
 * A reference that was not supplied resolves to nothing. The model therefore
 * cannot name a record the application did not put in front of it, cannot
 * invent one, and cannot reach a record the user may not read — the context was
 * assembled from an authorized Firestore read in the first place.
 *
 * `interpreted_filters` is the old contract, kept as a secondary output: it
 * populates the manual filter controls so the user can drop out of the AI
 * answer and into ordinary deterministic filtering.
 */

const freeText = (max: number) =>
  z.string().trim().min(1).max(max).refine((value) => !looksLikeDocumentId(value), {
    message: 'looks like a document ID',
  })

/**
 * AI_SPEC section 3.3, exactly.
 *
 * `strictObject` rejects an unknown field rather than ignoring it, so a model
 * that invents `item_id` fails validation instead of having it quietly dropped.
 */
export const smartSearchFiltersSchema = z.strictObject({
  search_text: freeText(120).optional(),
  category: freeText(60).optional(),
  team_name: freeText(60).optional(),
  location: freeText(120).optional(),
  conditions: z.array(z.enum(CONDITION_KEYS as unknown as [ConditionKey, ...ConditionKey[]]))
    .min(1)
    .max(CONDITION_KEYS.length)
    .optional(),
  availability: z.enum(['available', 'unavailable', 'any']).optional(),
})

export type SmartSearchFilters = z.infer<typeof smartSearchFiltersSchema>

/**
 * A name the model produced, resolved against real organization data.
 *
 * An unresolved name is dropped from the filter set and reported, never guessed
 * at: narrowing by a team that does not exist would silently return nothing and
 * look like an empty inventory.
 */
export interface ResolvedSmartSearch {
  /** Maps onto the manual filter state, so the normal controls can edit it. */
  filters: InventoryFilters
  /** Kept whole; applied separately when the model asked for more than one. */
  conditions: ConditionKey[]
  location: string
  /** Interpreted-filter chips, in the order they read best. */
  summary: string[]
  /** What could not be resolved, said plainly. */
  notes: string[]
}

export const EMPTY_RESOLVED: ResolvedSmartSearch = {
  filters: EMPTY_FILTERS,
  conditions: [],
  location: '',
  summary: [],
  notes: [],
}

function resolveCategory(value: string): string | null {
  const normalized = normalizeName(value)
  return INVENTORY_CATEGORIES.find((category) => normalizeName(category) === normalized) ?? null
}

/**
 * Deterministic team resolution, shared with the Requirement Generator.
 *
 * Exact normalized match first, then a contains match in either direction so
 * that "Sound" finds "Sound Crew" and "Lighting Team" finds "Lighting". A
 * second model call to resolve a name would put the model back in charge of an
 * identifier, which is the one thing it must never decide.
 */
export function resolveTeamName(
  name: string,
  teams: readonly TheaterTeam[],
): TheaterTeam | null {
  const normalized = normalizeName(name)
  if (normalized.length === 0) return null

  const exact = teams.filter((team) => normalizeName(team.name) === normalized)
  if (exact.length === 1) return exact[0] ?? null
  if (exact.length > 1) return null

  const partial = teams.filter((team) => {
    const teamName = normalizeName(team.name)
    return teamName.includes(normalized) || normalized.includes(teamName)
  })

  // Ambiguity is not resolved by picking one.
  return partial.length === 1 ? (partial[0] ?? null) : null
}

function conditionPhrase(conditions: readonly ConditionKey[]): string {
  return conditions.map((key) => CONDITION_LABELS[key]).join(' or ')
}

export function resolveSmartSearch(
  parsed: SmartSearchFilters,
  teams: readonly TheaterTeam[],
): ResolvedSmartSearch {
  const summary: string[] = []
  const notes: string[] = []

  const text = parsed.search_text?.trim() ?? ''
  if (text.length > 0) summary.push(`Text: ${text}`)

  let category = 'all'
  if (parsed.category) {
    const resolved = resolveCategory(parsed.category)
    if (resolved) {
      category = resolved
      summary.push(`Category: ${resolved}`)
    } else {
      notes.push(`"${parsed.category}" is not one of this app's categories, so it was ignored.`)
    }
  }

  let teamId = 'all'
  if (parsed.team_name) {
    const team = resolveTeamName(parsed.team_name, teams)
    if (team) {
      teamId = team.team_id
      summary.push(`Team: ${team.name}`)
    } else {
      notes.push(`No team named "${parsed.team_name}" in this organization, so that part was ignored.`)
    }
  }

  const conditions = parsed.conditions ?? []
  if (conditions.length > 0) summary.push(`Condition: ${conditionPhrase(conditions)}`)

  const availability =
    parsed.availability && parsed.availability !== 'any' ? parsed.availability : 'all'
  if (availability === 'available') summary.push('Only items with stock available')
  if (availability === 'unavailable') summary.push('Only items with none available')

  const location = parsed.location?.trim() ?? ''
  if (location.length > 0) summary.push(`Location: ${location}`)

  return {
    filters: {
      text,
      category,
      teamId,
      // A single condition goes into the manual dropdown so the user can change
      // it there. Several have no dropdown to live in and stay separate.
      condition: conditions.length === 1 ? (conditions[0] as string) : 'all',
      availability,
    },
    conditions,
    location,
    summary,
    notes,
  }
}

/**
 * The deterministic search, run over records the caller may already read.
 *
 * This narrows an authorized result set; it is not what keeps anyone out.
 */
export function applySmartSearch(
  items: readonly InventoryItem[],
  resolved: ResolvedSmartSearch,
  teams: readonly TheaterTeam[],
): InventoryItem[] {
  const base = filterInventoryItems(items, resolved.filters, teams)
  const location = normalizeName(resolved.location)

  return base.filter((item) => {
    if (resolved.conditions.length > 1) {
      const summaryKey = conditionSummary(item.condition_counts)
      if (!summaryKey || !resolved.conditions.includes(summaryKey)) return false
    }

    if (location.length > 0 && !normalizeName(item.location).includes(location)) return false

    return true
  })
}

/** True when the model asked for nothing the application can act on. */
export function isEmptySmartSearch(resolved: ResolvedSmartSearch): boolean {
  return (
    resolved.summary.length === 0
    && resolved.conditions.length === 0
    && resolved.location.length === 0
  )
}

/**
 * AI_SPEC section 3.3b: the data-aware response.
 *
 * `inventory_ref` is a request-local label such as `I7`. The schema has no
 * field for a document ID, and a reference that was not supplied is dropped
 * during resolution rather than trusted.
 */
const smartSearchMatchSchema = z.strictObject({
  inventory_ref: z.string().trim().min(1).max(8),
  reason: z.string().trim().max(200).optional(),
})

export const smartSearchAnswerSchema = z.strictObject({
  answer: z.string().trim().min(1).max(1200),
  matches: z.array(smartSearchMatchSchema).max(200),
  interpreted_filters: smartSearchFiltersSchema.optional(),
})

export type SmartSearchAnswer = z.infer<typeof smartSearchAnswerSchema>

export interface SmartSearchResult {
  /** The model's sentence, shown above the records. */
  answer: string
  /** Real Firestore records, in the order the model listed them. */
  items: InventoryItem[]
  /** Item ID to the model's short reason, where it gave one. */
  reasons: Map<string, string>
  /** The old filter contract, when the model also produced it. */
  resolved: ResolvedSmartSearch | null
  /** References the model produced that were never supplied. */
  unknownRefs: string[]
  /** How many accessible records did not fit in the request. */
  omittedCount: number
}

/**
 * Assemble the result from a validated response and the context that produced
 * it.
 *
 * Every record shown comes out of `context.byRef`. Nothing the model wrote is
 * used as data beyond choosing which of those records to show and what to say
 * about them.
 */
export function buildSmartSearchResult(params: {
  answer: SmartSearchAnswer
  context: InventoryContext
  teams: readonly TheaterTeam[]
}): SmartSearchResult {
  const refs = params.answer.matches.map((match) => match.inventory_ref)
  const { items, unknown } = resolveRefs(refs, params.context)

  const reasons = new Map<string, string>()
  for (const match of params.answer.matches) {
    const item = params.context.byRef.get(match.inventory_ref.trim().toUpperCase())
    if (item && match.reason && !reasons.has(item.item_id)) {
      reasons.set(item.item_id, match.reason)
    }
  }

  return {
    answer: params.answer.answer,
    items,
    reasons,
    resolved: params.answer.interpreted_filters
      ? resolveSmartSearch(params.answer.interpreted_filters, params.teams)
      : null,
    unknownRefs: unknown,
    omittedCount: params.context.omittedCount,
  }
}
