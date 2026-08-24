import { describe, expect, it } from 'vitest'
import {
  MAX_SUGGESTIONS, buildSuggestionDrafts, confidentMatch, draftBlocker, findInventoryCandidates,
  isSavable, requirementSuggestionSchema, requirementSuggestionsSchema, resolveSuggestionTeam,
  toRequirementInputs, type RequirementSuggestion, type SuggestionDraft,
} from '@/features/ai/requirement-generator'
import { parseRequirementResponse } from '@/features/ai/requirement-generator-service'
import { requirementAvailability, shortageOf } from '@/domain/production'
import { EMPTY_CONDITION_COUNTS } from '@/domain/inventory'
import type { InventoryItem } from '@/types/inventory'
import type { TheaterTeam } from '@/types/organization'

const TEAMS = [
  { team_id: 't-sound', name: 'Sound' },
  { team_id: 't-light', name: 'Lighting' },
] as unknown as TheaterTeam[]

const ALL_TEAM_IDS = ['t-sound', 't-light']

function item(overrides: Partial<InventoryItem> = {}): InventoryItem {
  return {
    item_id: 'i-mic',
    organization_id: 'org-1',
    name: 'Wireless Microphone',
    category: 'Microphones',
    team_id: 't-sound',
    quantity_total: 6,
    quantity_available: 6,
    condition_counts: { ...EMPTY_CONDITION_COUNTS, good: 6 },
    location: 'Storage Room A',
    created_by_uid: 'u-1',
    ...overrides,
  } as unknown as InventoryItem
}

function suggestion(overrides: Partial<RequirementSuggestion> = {}): RequirementSuggestion {
  return {
    client_temp_id: 'tmp-1',
    item_name: 'Wireless Microphones',
    suggested_qty: 12,
    ...overrides,
  }
}

describe('requirementSuggestionSchema', () => {
  it('accepts the AI_SPEC example', () => {
    const parsed = requirementSuggestionSchema.parse({
      client_temp_id: 'tmp-1',
      item_name: 'Wireless Microphones',
      suggested_qty: 12,
      category: 'Sound Equipment',
      suggested_team_name: 'Sound',
      rationale: 'Multiple performers require vocal reinforcement.',
    })

    expect(parsed.suggested_qty).toBe(12)
    expect(parsed.suggested_team_name).toBe('Sound')
  })

  it('rejects a quantity that is not a positive whole number', () => {
    expect(requirementSuggestionSchema.safeParse(suggestion({ suggested_qty: 0 })).success).toBe(false)
    expect(requirementSuggestionSchema.safeParse(suggestion({ suggested_qty: -3 })).success).toBe(false)
    expect(requirementSuggestionSchema.safeParse(suggestion({ suggested_qty: 2.5 })).success).toBe(false)
    expect(requirementSuggestionSchema.safeParse(suggestion({ suggested_qty: 100000 })).success).toBe(false)
  })

  it('has no field for any Firestore identifier', () => {
    expect(Object.keys(requirementSuggestionSchema.shape).sort()).toEqual([
      'category', 'client_temp_id', 'inventory_match_keyword', 'inventory_ref', 'item_name',
      'rationale', 'suggested_action', 'suggested_qty', 'suggested_team_name',
    ])
  })

  it('rejects a response carrying an identifier the application owns', () => {
    for (const field of [
      'requirement_id', 'production_id', 'organization_id', 'inventory_item_id', 'team_id',
      'created_by_uid',
    ]) {
      expect(
        requirementSuggestionSchema.safeParse({ ...suggestion(), [field]: 'x' }).success,
      ).toBe(false)
    }
  })

  it('rejects a shortage the model tried to calculate', () => {
    // Shortage is application arithmetic over real availability; a model-side
    // number could only ever be a guess wearing the same name.
    expect(requirementSuggestionSchema.safeParse({ ...suggestion(), shortage_qty: 4 }).success)
      .toBe(false)
    expect(requirementSuggestionSchema.safeParse({ ...suggestion(), available_qty: 2 }).success)
      .toBe(false)
  })

  it('rejects a value shaped like a document ID inside a text field', () => {
    expect(
      requirementSuggestionSchema.safeParse(suggestion({ suggested_team_name: 'a1B2c3D4e5F6g7H8i9J0' })).success,
    ).toBe(false)
  })

  it('caps how many suggestions one response may carry', () => {
    const many = Array.from({ length: MAX_SUGGESTIONS + 1 }, (_, index) =>
      suggestion({ client_temp_id: `tmp-${index}` }))
    expect(requirementSuggestionsSchema.safeParse(many).success).toBe(false)
  })
})

function response(suggestions: unknown[], summary = 'Your PA looks usable.') {
  return JSON.stringify({ summary, suggestions })
}

describe('parseRequirementResponse', () => {
  it('parses a well-formed assessment and draft', () => {
    const parsed = parseRequirementResponse(response([suggestion()]))
    expect(parsed.summary).toBe('Your PA looks usable.')
    expect(parsed.suggestions).toHaveLength(1)
    expect(parsed.discardedCount).toBe(0)
  })

  it('treats a draft with no usable suggestion as empty output', () => {
    expect(() => parseRequirementResponse(response([]))).toThrow(/usable/i)
    expect(() => parseRequirementResponse('')).toThrow(/nothing/i)
  })

  it('rejects a top level that cannot be read', () => {
    expect(() => parseRequirementResponse('{"summary":')).toThrow(/JSON/i)
    expect(() => parseRequirementResponse('"just a string"')).toThrow(/contract/i)
  })

  it('keeps the valid suggestions and counts the rest', () => {
    // Eight usable suggestions and two unreadable ones is eight suggestions and
    // a note, not a failed request.
    const parsed = parseRequirementResponse(response([
      suggestion({ client_temp_id: 'a' }),
      { client_temp_id: 'b', item_name: 'Rope', suggested_qty: 0 },
      suggestion({ client_temp_id: 'c' }),
      { client_temp_id: 'd', item_name: 'Rope', suggested_qty: 2, team_id: 't-1' },
    ]))

    expect(parsed.suggestions.map((entry) => entry.client_temp_id)).toEqual(['a', 'c'])
    expect(parsed.discardedCount).toBe(2)
  })

  it('salvages the complete part of a truncated answer', () => {
    // The SDK does not treat MAX_TOKENS as an error, so a cut-off draft arrives
    // as partial JSON. What was finished is still worth reviewing.
    const full = response([suggestion({ client_temp_id: 'a' }), suggestion({ client_temp_id: 'b' })])
    const cut = full.slice(0, full.length - 40)

    const parsed = parseRequirementResponse(cut, true)
    expect(parsed.suggestions.length).toBeGreaterThanOrEqual(1)
    expect(parsed.truncated).toBe(true)
  })

  it('reports a truncation with nothing complete as truncated, not malformed', () => {
    let threw: unknown
    try {
      parseRequirementResponse('{"summary":"Your PA lo', true)
    } catch (caught) {
      threw = caught
    }
    expect((threw as { kind: string }).kind).toBe('truncated')
  })

  it('parses the 200-seat musical example the old boundary rejected', () => {
    const parsed = parseRequirementResponse(response([
      { client_temp_id: 'tmp-1', item_name: 'Wireless Microphones', suggested_qty: 20, category: 'Microphones', suggested_team_name: 'Sound', inventory_ref: 'I1', rationale: 'Twenty vocalists are specified.', suggested_action: 'rent' },
      { client_temp_id: 'tmp-2', item_name: 'Stage Wash Lights', suggested_qty: 8, category: 'Lighting Instruments', suggested_team_name: 'Lighting', inventory_match_keyword: 'wash light', rationale: 'A 200-seat house needs even coverage.' },
    ], 'Your mixing console and speakers look usable. Wireless microphone capacity is the likely gap.'))

    expect(parsed.suggestions).toHaveLength(2)
    expect(parsed.discardedCount).toBe(0)
    expect(parsed.suggestions[0]?.inventory_ref).toBe('I1')
    expect(parsed.suggestions[0]?.suggested_action).toBe('rent')
  })
})

describe('safe normalization', () => {
  it('accepts a quantity written as a string', () => {
    const parsed = parseRequirementResponse(response([
      { client_temp_id: 'a', item_name: 'Rope', suggested_qty: '12' },
    ]))
    expect(parsed.suggestions[0]?.suggested_qty).toBe(12)
  })

  it('canonicalizes a category given in the wrong case', () => {
    const parsed = parseRequirementResponse(response([
      { client_temp_id: 'a', item_name: 'Rope', suggested_qty: 1, category: 'lighting instruments' },
    ]))
    expect(parsed.suggestions[0]?.category).toBe('Lighting Instruments')
  })

  it('accepts a well-known alias for a field that is otherwise absent', () => {
    const parsed = parseRequirementResponse(response([
      { id: 'a', name: 'Gaffer Tape', qty: 4, team: 'Sound' },
    ]))
    expect(parsed.suggestions[0]?.item_name).toBe('Gaffer Tape')
    expect(parsed.suggestions[0]?.suggested_qty).toBe(4)
    expect(parsed.suggestions[0]?.suggested_team_name).toBe('Sound')
  })

  it('leaves an ambiguous object alone rather than choosing for it', () => {
    // Both keys present means the model said two different things; picking one
    // would be a guess.
    const parsed = parseRequirementResponse(response([
      { client_temp_id: 'a', item_name: 'Rope', name: 'Cable', suggested_qty: 1 },
    ]))
    expect(parsed.suggestions[0]?.item_name).toBe('Rope')
  })

  it('drops an empty optional string instead of failing on it', () => {
    const parsed = parseRequirementResponse(response([
      { client_temp_id: 'a', item_name: 'Rope', suggested_qty: 1, rationale: '   ', category: '' },
    ]))
    expect(parsed.suggestions[0]).not.toHaveProperty('rationale')
    expect(parsed.suggestions[0]).not.toHaveProperty('category')
  })

  it('does not normalize an invalid quantity into a valid one', () => {
    expect(() => parseRequirementResponse(response([
      { client_temp_id: 'a', item_name: 'Rope', suggested_qty: 'lots' },
    ]))).toThrow(/usable/i)
    expect(() => parseRequirementResponse(response([
      { client_temp_id: 'a', item_name: 'Rope', suggested_qty: '0' },
    ]))).toThrow(/usable/i)
  })

  it('does not normalize an invented identifier into anything', () => {
    expect(() => parseRequirementResponse(response([
      { client_temp_id: 'a', item_name: 'Rope', suggested_qty: 1, inventory_item_id: 'abc' },
    ]))).toThrow(/usable/i)
  })
})

describe('resolveSuggestionTeam', () => {
  it('resolves a name the organization actually has', () => {
    expect(resolveSuggestionTeam({
      suggestedTeamName: 'Sound', teams: TEAMS, allowedTeamIds: ALL_TEAM_IDS,
    })).toEqual({ teamId: 't-sound', resolution: 'resolved' })
  })

  it('reports an unknown team instead of inventing one', () => {
    expect(resolveSuggestionTeam({
      suggestedTeamName: 'Pyrotechnics', teams: TEAMS, allowedTeamIds: ALL_TEAM_IDS,
    })).toEqual({ teamId: null, resolution: 'unknown-team' })
  })

  it('refuses a real team the reviewer may not write to', () => {
    // Security Rules would refuse this write; the review UI asks first.
    expect(resolveSuggestionTeam({
      suggestedTeamName: 'Lighting', teams: TEAMS, allowedTeamIds: ['t-sound'],
    })).toEqual({ teamId: null, resolution: 'not-allowed' })
  })

  it('reports a missing suggestion as missing', () => {
    expect(resolveSuggestionTeam({
      suggestedTeamName: undefined, teams: TEAMS, allowedTeamIds: ALL_TEAM_IDS,
    })).toEqual({ teamId: null, resolution: 'none' })
  })
})

describe('inventory keyword resolution', () => {
  const items = [
    item({ item_id: 'i-mic', name: 'Wireless Microphone' }),
    item({ item_id: 'i-mic2', name: 'Handheld Microphone', category: 'Microphones' }),
    item({ item_id: 'i-cable', name: 'XLR Cable', category: 'Cables' }),
  ]

  it('offers candidates ranked by how the match was made', () => {
    const found = findInventoryCandidates('microphone', items)
    expect(found.map((entry) => entry.item_id)).toEqual(['i-mic', 'i-mic2'])
  })

  it('falls back to category matches', () => {
    expect(findInventoryCandidates('cables', items).map((entry) => entry.item_id))
      .toEqual(['i-cable'])
  })

  it('returns nothing for a keyword nothing matches', () => {
    expect(findInventoryCandidates('fog machine', items)).toEqual([])
    expect(findInventoryCandidates('', items)).toEqual([])
  })

  it('binds only an unambiguous exact name', () => {
    expect(confidentMatch('wireless microphone', items)?.item_id).toBe('i-mic')
  })

  it('refuses to bind a fuzzy keyword', () => {
    // A wrong link produces a wrong shortage on a real record, silently.
    expect(confidentMatch('microphone', items)).toBeNull()
    expect(confidentMatch('mic', items)).toBeNull()
  })

  it('refuses to bind when two items share the name', () => {
    const duplicated = [item({ item_id: 'a' }), item({ item_id: 'b' })]
    expect(confidentMatch('Wireless Microphone', duplicated)).toBeNull()
  })
})

describe('buildSuggestionDrafts', () => {
  const items = [item({ item_id: 'i-mic', name: 'Wireless Microphone' })]

  function build(suggestions: RequirementSuggestion[], allowed = ALL_TEAM_IDS) {
    return buildSuggestionDrafts(suggestions, { teams: TEAMS, allowedTeamIds: allowed, items })
  }

  it('starts every row unaccepted', () => {
    // Generation succeeding is not approval.
    const drafts = build([suggestion({ suggested_team_name: 'Sound' })])
    expect(drafts[0]?.accepted).toBe(false)
  })

  it('carries the quantity and rationale through for editing', () => {
    const drafts = build([suggestion({ suggested_qty: 12, rationale: 'Twenty performers.' })])
    expect(drafts[0]?.requiredQty).toBe(12)
    expect(drafts[0]?.notes).toBe('Twenty performers.')
  })

  it('resolves the team it can and flags the team it cannot', () => {
    const drafts = build([
      suggestion({ client_temp_id: 'a', suggested_team_name: 'Sound' }),
      suggestion({ client_temp_id: 'b', suggested_team_name: 'Pyrotechnics' }),
      suggestion({ client_temp_id: 'c' }),
    ])

    expect(drafts.map((draft) => draft.teamResolution))
      .toEqual(['resolved', 'unknown-team', 'none'])
    expect(drafts[1]?.teamId).toBeNull()
  })

  it('links an exact inventory match and leaves a fuzzy one unmatched', () => {
    const drafts = build([
      suggestion({ client_temp_id: 'a', inventory_match_keyword: 'Wireless Microphone' }),
      suggestion({ client_temp_id: 'b', inventory_match_keyword: 'microphone' }),
    ])

    expect(drafts[0]?.inventoryItemId).toBe('i-mic')
    expect(drafts[1]?.inventoryItemId).toBeNull()
    expect(drafts[1]?.candidates.map((entry) => entry.item_id)).toEqual(['i-mic'])
  })

  it('uniquifies a repeated key from the model', () => {
    const drafts = build([suggestion({ client_temp_id: 'tmp-1' }), suggestion({ client_temp_id: 'tmp-1' })])
    expect(new Set(drafts.map((draft) => draft.key)).size).toBe(2)
  })

  it('leaves everything unmatched when no inventory was supplied', () => {
    const drafts = buildSuggestionDrafts([suggestion({ inventory_match_keyword: 'Wireless Microphone' })], {
      teams: TEAMS, allowedTeamIds: ALL_TEAM_IDS, items: [],
    })

    expect(drafts[0]?.inventoryItemId).toBeNull()
    expect(drafts[0]?.candidates).toEqual([])
  })
})

describe('approval, edit, and removal', () => {
  function drafts() {
    return buildSuggestionDrafts(
      [
        suggestion({ client_temp_id: 'a', item_name: 'Wireless Microphones', suggested_team_name: 'Sound' }),
        suggestion({ client_temp_id: 'b', item_name: 'Source Four Lights', suggested_team_name: 'Lighting' }),
      ],
      { teams: TEAMS, allowedTeamIds: ALL_TEAM_IDS, items: [] },
    )
  }

  function accept(draft: SuggestionDraft, patch: Partial<SuggestionDraft> = {}): SuggestionDraft {
    return { ...draft, accepted: true, ...patch }
  }

  it('saves nothing while nothing has been accepted', () => {
    expect(toRequirementInputs(drafts(), ALL_TEAM_IDS)).toEqual([])
  })

  it('saves only the accepted rows', () => {
    const [first, second] = drafts()
    const inputs = toRequirementInputs([accept(first as SuggestionDraft), second as SuggestionDraft], ALL_TEAM_IDS)

    expect(inputs).toHaveLength(1)
    expect(inputs[0]?.itemName).toBe('Wireless Microphones')
  })

  it('carries a user edit into the save payload', () => {
    const [first] = drafts()
    const inputs = toRequirementInputs(
      [accept(first as SuggestionDraft, { requiredQty: 8, itemName: '  Handheld Mics  ' })],
      ALL_TEAM_IDS,
    )

    expect(inputs[0]?.requiredQty).toBe(8)
    expect(inputs[0]?.itemName).toBe('Handheld Mics')
  })

  it('produces nothing for a removed row', () => {
    const [, second] = drafts()
    expect(toRequirementInputs([accept(second as SuggestionDraft)], ALL_TEAM_IDS)).toHaveLength(1)
    expect(toRequirementInputs([], ALL_TEAM_IDS)).toEqual([])
  })

  it('refuses to save an accepted row with no team', () => {
    const [first] = drafts()
    const noTeam = accept(first as SuggestionDraft, { teamId: null })

    expect(draftBlocker(noTeam, ALL_TEAM_IDS)).toBe('team')
    expect(isSavable(noTeam, ALL_TEAM_IDS)).toBe(false)
    expect(toRequirementInputs([noTeam], ALL_TEAM_IDS)).toEqual([])
  })

  it('refuses to save a team the reviewer may not write to', () => {
    // AI does not override team scope; it never gets that far.
    const [, second] = drafts()
    const outside = accept(second as SuggestionDraft)

    expect(toRequirementInputs([outside], ['t-sound'])).toEqual([])
    expect(draftBlocker(outside, ['t-sound'])).toBe('team')
  })

  it('refuses to save an invalid quantity or a blank name', () => {
    const [first] = drafts()
    expect(draftBlocker(accept(first as SuggestionDraft, { requiredQty: 0 }), ALL_TEAM_IDS)).toBe('quantity')
    expect(draftBlocker(accept(first as SuggestionDraft, { requiredQty: 1.5 }), ALL_TEAM_IDS)).toBe('quantity')
    expect(draftBlocker(accept(first as SuggestionDraft, { itemName: '  ' }), ALL_TEAM_IDS)).toBe('name')
  })

  it('never carries a suggestion-only field into the save payload', () => {
    const [first] = drafts()
    const inputs = toRequirementInputs([accept(first as SuggestionDraft)], ALL_TEAM_IDS)

    expect(Object.keys(inputs[0] ?? {}).sort())
      .toEqual(['inventoryItemId', 'itemName', 'notes', 'requiredQty', 'teamId'])
  })
})

describe('shortage stays application arithmetic', () => {
  it('is computed from real availability after the requirement is saved', () => {
    const saved = { inventory_item_id: 'i-mic', required_qty: 12 }
    const availability = requirementAvailability(saved, [item({ quantity_available: 6 })])

    expect(availability).toEqual({ matched: true, available: 6, shortage: 6, alreadyAvailable: false })
    expect(shortageOf(12, 6)).toBe(6)
  })

  it('is zero, not negative, when stock covers the requirement', () => {
    expect(shortageOf(4, 10)).toBe(0)
  })
})
