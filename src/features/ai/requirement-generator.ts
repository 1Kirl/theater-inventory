import { z } from 'zod'
import { looksLikeDocumentId, normalizeName } from '@/features/ai/ai-guards'
import { resolveTeamName } from '@/features/ai/smart-search'
import { EMPTY_CONTEXT, type InventoryContext } from '@/features/ai/inventory-context'
import { shortageOf } from '@/domain/production'
import type { ActionType } from '@/types/production'
import type { RequirementInput } from '@/domain/production-payloads'
import type { InventoryItem } from '@/types/inventory'
import type { TheaterTeam } from '@/types/organization'

/**
 * AI Requirement Generator: a first draft, never a write.
 *
 * The model is given the production's text and a compact view of the inventory
 * the user may read, so its draft can say "you have eight of these, this
 * production wants twenty" instead of listing equipment in the abstract. It
 * points at existing records with request-local references.
 *
 * Everything that touches Firestore — the team ID, the inventory link, the
 * shortage, the document itself — is resolved and decided here and by the
 * person reviewing. A suggestion that is never accepted never becomes anything,
 * and a reference that was not supplied resolves to nothing.
 */

const freeText = (max: number) =>
  z.string().trim().min(1).max(max).refine((value) => !looksLikeDocumentId(value), {
    message: 'looks like a document ID',
  })

export const MAX_SUGGESTIONS = 15
export const MAX_SUGGESTED_QTY = 999

/**
 * AI_SPEC section 4.3, exactly.
 *
 * `client_temp_id` is a key for the review list and nothing else; it never
 * reaches Firestore. `strictObject` rejects an unknown field, so a model that
 * returns `inventory_item_id`, `team_id`, or a shortage fails validation rather
 * than having it quietly ignored.
 */
export const requirementSuggestionSchema = z.strictObject({
  client_temp_id: freeText(40),
  item_name: freeText(120),
  suggested_qty: z.number().int().min(1).max(MAX_SUGGESTED_QTY),
  category: freeText(60).optional(),
  suggested_team_name: freeText(60).optional(),
  /** A request-local reference such as `I7`, pointing at a supplied record. */
  inventory_ref: z.string().trim().min(1).max(8).optional(),
  inventory_match_keyword: freeText(120).optional(),
  rationale: freeText(500).optional(),
  /**
   * Transient advice, shown in the review UI and never persisted on the
   * requirement.
   *
   * Decision 48 removed `production_requirements.action_type` because a second
   * copy of the plan could disagree with the Action Item, which is the only
   * place it lives. This does not bring it back: it is a hint about what the
   * reviewer might do next, and it does not survive the save.
   */
  suggested_action: z.enum(['buy', 'rent', 'build', 'repair']).optional(),
})

export const requirementSuggestionsSchema = z
  .array(requirementSuggestionSchema)
  .min(1)
  .max(MAX_SUGGESTIONS)

/** The data-aware response: an assessment for the person, then the draft. */
export const requirementResponseSchema = z.strictObject({
  summary: z.string().trim().min(1).max(1200),
  suggestions: requirementSuggestionsSchema,
})

export type RequirementSuggestion = z.infer<typeof requirementSuggestionSchema>
export type RequirementResponse = z.infer<typeof requirementResponseSchema>

/**
 * Why a suggestion cannot be saved yet.
 *
 * `not-allowed` is the case that matters: the model suggested a real team the
 * reviewer has no edit rights over. Security Rules would refuse the write, and
 * the review UI asks for an allowed team rather than letting it fail at save.
 */
export type TeamResolution = 'resolved' | 'unknown-team' | 'not-allowed' | 'none'

export interface SuggestionDraft {
  /** React key and identity within the review list. Never a Firestore ID. */
  key: string
  itemName: string
  requiredQty: number
  notes: string
  teamId: string | null
  teamResolution: TeamResolution
  /** What the model said, kept so the reviewer can see what was interpreted. */
  suggestedTeamName: string | null
  suggestedCategory: string | null
  matchKeyword: string | null
  /** Advice only. Never written to the requirement; decision 48 stands. */
  suggestedAction: ActionType | null
  inventoryItemId: string | null
  /** True when the model pointed at a record that was never supplied. */
  refWasUnknown: boolean
  /** Deterministic candidates from real inventory, for the reviewer to pick. */
  candidates: InventoryItem[]
  accepted: boolean
}

/**
 * The numbers shown as facts, computed by the application.
 *
 * Availability is the matched item's `quantity_available`, read from the real
 * record, and shortage is the Phase 5 arithmetic over it. The model is not
 * consulted and has no field to answer with: whatever it said in its prose, the
 * figures on screen come from here and move when the reviewer edits a quantity
 * or changes the match.
 */
export interface DraftFacts {
  matched: InventoryItem | null
  available: number | null
  shortage: number | null
}

export function draftFacts(
  draft: Pick<SuggestionDraft, 'inventoryItemId' | 'requiredQty'>,
  items: readonly InventoryItem[],
): DraftFacts {
  if (!draft.inventoryItemId) return { matched: null, available: null, shortage: null }

  const matched = items.find((item) => item.item_id === draft.inventoryItemId) ?? null
  if (!matched) return { matched: null, available: null, shortage: null }

  const available = matched.quantity_available
  return { matched, available, shortage: shortageOf(draft.requiredQty, available) }
}

const MAX_CANDIDATES = 5

/**
 * Deterministic inventory candidates for a keyword.
 *
 * Exact normalized name matches first, then names containing the keyword, then
 * categories. Ranking is by how the match was made, never by a score the model
 * supplied.
 */
export function findInventoryCandidates(
  keyword: string,
  items: readonly InventoryItem[],
  limit = MAX_CANDIDATES,
): InventoryItem[] {
  const needle = normalizeName(keyword)
  if (needle.length === 0) return []

  const exact: InventoryItem[] = []
  const byName: InventoryItem[] = []
  const byCategory: InventoryItem[] = []

  for (const item of items) {
    const name = normalizeName(item.name)
    if (name === needle) exact.push(item)
    else if (name.includes(needle) || needle.includes(name)) byName.push(item)
    else if (normalizeName(item.category).includes(needle)) byCategory.push(item)
  }

  return [...exact, ...byName, ...byCategory].slice(0, limit)
}

/**
 * The only case where the application links a suggestion on its own.
 *
 * One item, whose name matches the keyword exactly once normalization is
 * applied. Anything looser is shown as a candidate for the reviewer to confirm:
 * a wrong link would quietly produce a wrong shortage on a real record.
 */
export function confidentMatch(
  keyword: string,
  items: readonly InventoryItem[],
): InventoryItem | null {
  const needle = normalizeName(keyword)
  if (needle.length === 0) return null

  const exact = items.filter((item) => normalizeName(item.name) === needle)
  return exact.length === 1 ? (exact[0] ?? null) : null
}

export function resolveSuggestionTeam(params: {
  suggestedTeamName: string | undefined
  teams: readonly TheaterTeam[]
  allowedTeamIds: readonly string[]
}): { teamId: string | null; resolution: TeamResolution } {
  if (!params.suggestedTeamName) return { teamId: null, resolution: 'none' }

  const team = resolveTeamName(params.suggestedTeamName, params.teams)
  if (!team) return { teamId: null, resolution: 'unknown-team' }
  if (!params.allowedTeamIds.includes(team.team_id)) {
    return { teamId: null, resolution: 'not-allowed' }
  }

  return { teamId: team.team_id, resolution: 'resolved' }
}

/**
 * Turn validated suggestions into review rows.
 *
 * Nothing starts accepted. Generation succeeding is not approval, and this is
 * the shape of that rule in code.
 */
export function buildSuggestionDrafts(
  suggestions: readonly RequirementSuggestion[],
  context: {
    teams: readonly TheaterTeam[]
    allowedTeamIds: readonly string[]
    items: readonly InventoryItem[]
    /** The references that were supplied. Absent means none were. */
    inventoryContext?: InventoryContext
  },
): SuggestionDraft[] {
  const usedKeys = new Set<string>()
  const refs = context.inventoryContext ?? EMPTY_CONTEXT

  return suggestions.map((suggestion, index) => {
    // The model's key is only a hint; duplicates would break the review list.
    let key = suggestion.client_temp_id
    if (usedKeys.has(key)) key = `${key}-${index}`
    usedKeys.add(key)

    const team = resolveSuggestionTeam({
      suggestedTeamName: suggestion.suggested_team_name,
      teams: context.teams,
      allowedTeamIds: context.allowedTeamIds,
    })

    // A reference the application supplied is the strongest link there is: the
    // model is pointing at a record it was shown. A reference it made up
    // resolves to nothing and falls back to the keyword, exactly as if it had
    // never pointed at anything.
    const referenced = suggestion.inventory_ref
      ? refs.byRef.get(suggestion.inventory_ref.trim().toUpperCase()) ?? null
      : null
    const refWasUnknown = Boolean(suggestion.inventory_ref) && referenced === null

    const keyword = suggestion.inventory_match_keyword ?? suggestion.item_name
    const matched = referenced ?? confidentMatch(keyword, context.items)

    return {
      key,
      itemName: suggestion.item_name,
      requiredQty: suggestion.suggested_qty,
      notes: suggestion.rationale ?? '',
      teamId: team.teamId,
      teamResolution: team.resolution,
      suggestedTeamName: suggestion.suggested_team_name ?? null,
      suggestedCategory: suggestion.category ?? null,
      matchKeyword: suggestion.inventory_match_keyword ?? null,
      suggestedAction: suggestion.suggested_action ?? null,
      inventoryItemId: matched?.item_id ?? null,
      refWasUnknown,
      candidates: findInventoryCandidates(keyword, context.items),
      accepted: false,
    }
  })
}

export type DraftBlocker = 'team' | 'quantity' | 'name' | null

/** What still stands between a draft and a save, in the order worth fixing. */
export function draftBlocker(
  draft: SuggestionDraft,
  allowedTeamIds: readonly string[],
): DraftBlocker {
  if (draft.itemName.trim().length === 0) return 'name'
  if (!Number.isInteger(draft.requiredQty) || draft.requiredQty < 1) return 'quantity'
  if (!draft.teamId || !allowedTeamIds.includes(draft.teamId)) return 'team'
  return null
}

export function isSavable(draft: SuggestionDraft, allowedTeamIds: readonly string[]): boolean {
  return draft.accepted && draftBlocker(draft, allowedTeamIds) === null
}

/**
 * The save payloads, built only from accepted and unblocked drafts.
 *
 * A draft the reviewer never accepted produces nothing, and a draft naming a
 * team the reviewer may not write to is dropped here rather than being sent for
 * Security Rules to refuse.
 */
export function toRequirementInputs(
  drafts: readonly SuggestionDraft[],
  allowedTeamIds: readonly string[],
): RequirementInput[] {
  return drafts
    .filter((draft) => isSavable(draft, allowedTeamIds))
    .map((draft) => ({
      itemName: draft.itemName.trim(),
      inventoryItemId: draft.inventoryItemId,
      requiredQty: draft.requiredQty,
      teamId: draft.teamId as string,
      notes: draft.notes.trim() || undefined,
    }))
}
