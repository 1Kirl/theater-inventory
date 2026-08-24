import { describe, expect, it } from 'vitest'
import {
  EMPTY_RESOLVED, applySmartSearch, isEmptySmartSearch, resolveSmartSearch, resolveTeamName,
  smartSearchFiltersSchema,
} from '@/features/ai/smart-search'
import { parseSmartSearchAnswer } from '@/features/ai/smart-search-service'
import { looksLikeDocumentId } from '@/features/ai/ai-guards'
import { EMPTY_CONDITION_COUNTS } from '@/domain/inventory'
import type { ConditionCounts, InventoryItem } from '@/types/inventory'
import type { TheaterTeam } from '@/types/organization'

const TEAMS = [
  { team_id: 't-sound', name: 'Sound' },
  { team_id: 't-light', name: 'Lighting Crew' },
] as unknown as TheaterTeam[]

function counts(overrides: Partial<ConditionCounts> = {}): ConditionCounts {
  return { ...EMPTY_CONDITION_COUNTS, ...overrides }
}

function item(overrides: Partial<InventoryItem> = {}): InventoryItem {
  return {
    item_id: 'i-1',
    organization_id: 'org-1',
    name: 'Wireless Microphone',
    category: 'Microphones',
    team_id: 't-sound',
    quantity_total: 4,
    quantity_available: 4,
    condition_counts: counts({ good: 4 }),
    location: 'Storage Room A',
    created_by_uid: 'u-1',
    ...overrides,
  } as unknown as InventoryItem
}

describe('smartSearchFiltersSchema', () => {
  it('accepts the AI_SPEC example', () => {
    const parsed = smartSearchFiltersSchema.parse({
      search_text: 'microphone',
      conditions: ['needs_repair'],
      availability: 'available',
    })

    expect(parsed.conditions).toEqual(['needs_repair'])
    expect(parsed.availability).toBe('available')
  })

  it('accepts an empty object, because "show everything" is a real answer', () => {
    expect(smartSearchFiltersSchema.parse({})).toEqual({})
  })

  it('keeps conditions an array even for a single value', () => {
    // A "damaged or unusable" query is only expressible as a list.
    const parsed = smartSearchFiltersSchema.parse({ conditions: ['needs_repair', 'unusable'] })
    expect(parsed.conditions).toHaveLength(2)
  })

  it('rejects a condition outside the canonical five', () => {
    expect(smartSearchFiltersSchema.safeParse({ conditions: ['broken'] }).success).toBe(false)
    expect(smartSearchFiltersSchema.safeParse({ conditions: [] }).success).toBe(false)
  })

  it('rejects an unknown field rather than ignoring it', () => {
    // AI_SPEC section 6: an invented field is a failed response, not a
    // response with something quietly dropped.
    expect(smartSearchFiltersSchema.safeParse({ item_id: 'abc' }).success).toBe(false)
    expect(smartSearchFiltersSchema.safeParse({ organization_id: 'org-1' }).success).toBe(false)
  })

  it('has no place in the contract for any identifier', () => {
    expect(Object.keys(smartSearchFiltersSchema.shape).sort()).toEqual([
      'availability', 'category', 'conditions', 'location', 'search_text', 'team_name',
    ])
    expect(smartSearchFiltersSchema.safeParse({ team_id: 't-sound' }).success).toBe(false)
  })

  it('rejects a value shaped like a Firestore document ID', () => {
    expect(smartSearchFiltersSchema.safeParse({ team_name: 'a1B2c3D4e5F6g7H8i9J0' }).success)
      .toBe(false)
    expect(smartSearchFiltersSchema.safeParse({ team_name: 'Sound' }).success).toBe(true)
  })

  it('rejects an availability value outside the three', () => {
    expect(smartSearchFiltersSchema.safeParse({ availability: 'some' }).success).toBe(false)
  })
})

describe('looksLikeDocumentId', () => {
  it('recognizes the Firestore auto-ID shape', () => {
    expect(looksLikeDocumentId('a1B2c3D4e5F6g7H8i9J0')).toBe(true)
  })

  it('leaves ordinary words alone', () => {
    expect(looksLikeDocumentId('Microphones')).toBe(false)
    expect(looksLikeDocumentId('Lighting Instruments')).toBe(false)
    // Twenty characters, but no digits: a phrase, not an ID.
    expect(looksLikeDocumentId('Miscellaneous Techni')).toBe(false)
  })
})

describe('parseSmartSearchAnswer', () => {
  const ok = '{"answer":"Six items have never been inspected.","matches":[{"inventory_ref":"I1"}]}'

  it('parses a well-formed answer', () => {
    const parsed = parseSmartSearchAnswer(ok)
    expect(parsed.answer).toMatch(/never been inspected/)
    expect(parsed.matches).toEqual([{ inventory_ref: 'I1' }])
  })

  it('rejects empty output', () => {
    expect(() => parseSmartSearchAnswer('   ')).toThrow(/nothing/i)
  })

  it('rejects JSON with nothing complete in it', () => {
    expect(() => parseSmartSearchAnswer('{"answer": ')).toThrow(/JSON/i)
  })

  it('rejects an answer that does not match the contract', () => {
    expect(() => parseSmartSearchAnswer('{"item_id":"abc"}')).toThrow(/contract/i)
    // An answer with no sentence is not an answer.
    expect(() => parseSmartSearchAnswer('{"matches":[]}')).toThrow(/contract/i)
  })

  it('tolerates a missing matches array', () => {
    // "Nothing here matches" is a real answer, and some responses omit the key
    // rather than sending an empty list.
    expect(parseSmartSearchAnswer('{"answer":"Nothing matches."}').matches).toEqual([])
  })

  it('tolerates a match given as a bare reference string', () => {
    const parsed = parseSmartSearchAnswer('{"answer":"One.","matches":["I3"]}')
    expect(parsed.matches).toEqual([{ inventory_ref: 'I3' }])
  })

  it('drops an empty optional string rather than failing on it', () => {
    const parsed = parseSmartSearchAnswer('{"answer":"One.","matches":[{"inventory_ref":"I3","reason":"  "}]}')
    expect(parsed.matches[0]).toEqual({ inventory_ref: 'I3' })
  })
})

describe('resolveTeamName', () => {
  it('matches exactly, ignoring case and spacing', () => {
    expect(resolveTeamName('  sound  ', TEAMS)?.team_id).toBe('t-sound')
  })

  it('matches a partial name in either direction', () => {
    expect(resolveTeamName('Lighting', TEAMS)?.team_id).toBe('t-light')
    expect(resolveTeamName('Sound Crew', TEAMS)?.team_id).toBe('t-sound')
  })

  it('refuses to pick one when several could match', () => {
    const ambiguous = [
      { team_id: 't-a', name: 'Stage Left' },
      { team_id: 't-b', name: 'Stage Right' },
    ] as unknown as TheaterTeam[]
    expect(resolveTeamName('Stage', ambiguous)).toBeNull()
  })

  it('returns null for a team that does not exist', () => {
    expect(resolveTeamName('Pyrotechnics', TEAMS)).toBeNull()
    expect(resolveTeamName('', TEAMS)).toBeNull()
  })
})

describe('resolveSmartSearch', () => {
  it('maps a full result onto the deterministic filter state', () => {
    const resolved = resolveSmartSearch(
      {
        search_text: 'microphone',
        category: 'microphones',
        team_name: 'Sound',
        conditions: ['needs_repair'],
        availability: 'available',
        location: 'Storage Room A',
      },
      TEAMS,
    )

    expect(resolved.filters).toEqual({
      text: 'microphone',
      category: 'Microphones',
      teamId: 't-sound',
      condition: 'needs_repair',
      availability: 'available',
    })
    expect(resolved.location).toBe('Storage Room A')
    expect(resolved.notes).toEqual([])
  })

  it('drops an unknown category and says so instead of guessing', () => {
    const resolved = resolveSmartSearch({ category: 'Pyrotechnics' }, TEAMS)

    expect(resolved.filters.category).toBe('all')
    expect(resolved.notes.join(' ')).toMatch(/Pyrotechnics/)
  })

  it('drops an unresolvable team and says so', () => {
    // Filtering by a team that does not exist would return nothing and read as
    // an empty inventory.
    const resolved = resolveSmartSearch({ team_name: 'Pyro' }, TEAMS)

    expect(resolved.filters.teamId).toBe('all')
    expect(resolved.notes.join(' ')).toMatch(/Pyro/)
  })

  it('treats availability "any" as no constraint', () => {
    expect(resolveSmartSearch({ availability: 'any' }, TEAMS).filters.availability).toBe('all')
  })

  it('leaves the condition dropdown alone when the model asked for several', () => {
    const resolved = resolveSmartSearch({ conditions: ['needs_repair', 'unusable'] }, TEAMS)

    expect(resolved.filters.condition).toBe('all')
    expect(resolved.conditions).toEqual(['needs_repair', 'unusable'])
  })

  it('reports an empty interpretation as empty', () => {
    expect(isEmptySmartSearch(resolveSmartSearch({}, TEAMS))).toBe(true)
    expect(isEmptySmartSearch(resolveSmartSearch({ search_text: 'cable' }, TEAMS))).toBe(false)
    expect(isEmptySmartSearch(EMPTY_RESOLVED)).toBe(true)
  })
})

describe('applySmartSearch', () => {
  const items = [
    item({ item_id: 'i-mic', name: 'Wireless Microphone', condition_counts: counts({ needs_repair: 4 }) }),
    item({ item_id: 'i-cable', name: 'XLR Cable', category: 'Cables', condition_counts: counts({ good: 10 }), location: 'Loft B' }),
    item({ item_id: 'i-dead', name: 'Old Dimmer', category: 'Lighting Instruments', quantity_available: 0, condition_counts: counts({ unusable: 2 }) }),
  ]

  it('returns real records narrowed by the interpreted filters', () => {
    const resolved = resolveSmartSearch({ search_text: 'microphone', conditions: ['needs_repair'] }, TEAMS)
    expect(applySmartSearch(items, resolved, TEAMS).map((entry) => entry.item_id)).toEqual(['i-mic'])
  })

  it('applies several conditions as a set', () => {
    const resolved = resolveSmartSearch({ conditions: ['needs_repair', 'unusable'] }, TEAMS)
    expect(applySmartSearch(items, resolved, TEAMS).map((entry) => entry.item_id))
      .toEqual(['i-mic', 'i-dead'])
  })

  it('applies location as a substring of the real location', () => {
    const resolved = resolveSmartSearch({ location: 'loft' }, TEAMS)
    expect(applySmartSearch(items, resolved, TEAMS).map((entry) => entry.item_id)).toEqual(['i-cable'])
  })

  it('applies availability without inventing a number', () => {
    const resolved = resolveSmartSearch({ availability: 'unavailable' }, TEAMS)
    expect(applySmartSearch(items, resolved, TEAMS).map((entry) => entry.item_id)).toEqual(['i-dead'])
  })

  it('returns everything when nothing was interpreted', () => {
    expect(applySmartSearch(items, EMPTY_RESOLVED, TEAMS)).toHaveLength(3)
  })

  it('returns an empty list rather than a fallback when nothing matches', () => {
    const resolved = resolveSmartSearch({ search_text: 'fog machine' }, TEAMS)
    expect(applySmartSearch(items, resolved, TEAMS)).toEqual([])
  })

  it('cannot produce an item the caller did not pass in', () => {
    const resolved = resolveSmartSearch({ search_text: 'microphone' }, TEAMS)
    expect(applySmartSearch([], resolved, TEAMS)).toEqual([])
  })
})
