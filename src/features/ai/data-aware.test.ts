import { describe, expect, it } from 'vitest'
import { Timestamp } from 'firebase/firestore'
import type { AiGenerate, AiResponse, StructuredRequest } from '@/features/ai/ai-client'
import { askInventoryQuestion } from '@/features/ai/smart-search-service'
import { generateRequirementDraft } from '@/features/ai/requirement-generator-service'
import {
  buildSuggestionDrafts, draftFacts, toRequirementInputs,
} from '@/features/ai/requirement-generator'
import { buildInventoryContext } from '@/features/ai/inventory-context'
import { EMPTY_CONDITION_COUNTS } from '@/domain/inventory'
import type { ConditionCounts, InventoryItem } from '@/types/inventory'
import type { Production } from '@/types/production'
import type { TheaterTeam } from '@/types/organization'

/**
 * Data-aware behaviour, exercised with a stubbed model boundary.
 *
 * These cover the property the whole design rests on: whatever the model says,
 * the records shown and the numbers stated come from the application.
 */

const TEAMS = [
  { team_id: 't-sound', name: 'Sound' },
  { team_id: 't-light', name: 'Lighting' },
] as unknown as TheaterTeam[]

const ALL_TEAM_IDS = ['t-sound', 't-light']

const PRODUCTION = {
  title: 'Spring Musical',
  description: 'A school musical in a 200-seat auditorium with 20 vocalists.',
} as unknown as Production

function counts(overrides: Partial<ConditionCounts> = {}): ConditionCounts {
  return { ...EMPTY_CONDITION_COUNTS, ...overrides }
}

function item(overrides: Partial<InventoryItem> = {}): InventoryItem {
  return {
    item_id: 'i-mic',
    organization_id: 'org-1',
    name: 'Shure BLX Wireless Microphone',
    category: 'Microphones',
    team_id: 't-sound',
    quantity_total: 10,
    quantity_available: 8,
    condition_counts: counts({ good: 8, needs_repair: 2 }),
    location: 'Sound Storage',
    created_by_uid: 'u-1',
    ...overrides,
  } as unknown as InventoryItem
}

const INVENTORY = [
  item(),
  item({
    item_id: 'i-fresnel',
    name: 'Fresnel Lantern',
    category: 'Lighting Instruments',
    team_id: 't-light',
    quantity_total: 6,
    quantity_available: 0,
    condition_counts: counts({ unusable: 6 }),
    location: 'Lighting Storage',
  }),
  item({
    item_id: 'i-cable',
    name: 'XLR Cable',
    category: 'Cables',
    quantity_total: 20,
    quantity_available: 20,
    condition_counts: counts({ good: 20 }),
    last_inspected_at: Timestamp.fromDate(new Date(2026, 6, 10)),
  }),
]

function stub(text: string): { generate: AiGenerate; seen: StructuredRequest[] } {
  const seen: StructuredRequest[] = []
  return {
    seen,
    generate: (request) => {
      seen.push(request)
      return Promise.resolve({ text, truncated: false } satisfies AiResponse)
    },
  }
}

describe('Smart Search reads the inventory it was given', () => {
  it('sends the accessible records, each under a reference', async () => {
    const { generate, seen } = stub('{"answer":"ok","matches":[]}')
    await askInventoryQuestion({ query: 'anything', items: INVENTORY, teams: TEAMS, generate })

    const prompt = seen[0]?.prompt ?? ''
    expect(prompt).toContain('I1 | Shure BLX Wireless Microphone')
    expect(prompt).toContain('I2 | Fresnel Lantern')
    expect(prompt).toContain('INVENTORY_DATA')
  })

  it('sends no document ID, and nothing about accounts', async () => {
    const { generate, seen } = stub('{"answer":"ok","matches":[]}')
    await askInventoryQuestion({ query: 'anything', items: INVENTORY, teams: TEAMS, generate })

    const prompt = seen[0]?.prompt ?? ''
    for (const forbidden of ['i-mic', 'i-fresnel', 'org-1', 'u-1', 't-sound']) {
      expect(prompt).not.toContain(forbidden)
    }
    expect(prompt).not.toMatch(/uid|email|password|token/i)
  })

  it('answers a never-inspected question with the records that have no date', async () => {
    // The model is told `last_inspected: null`, which is what makes the
    // question answerable at all.
    const { generate, seen } = stub(JSON.stringify({
      answer: 'Two items have no inspection history: the wireless microphones and the lanterns.',
      matches: [
        { inventory_ref: 'I1', reason: 'never inspected' },
        { inventory_ref: 'I2', reason: 'never inspected' },
      ],
    }))

    const result = await askInventoryQuestion({
      query: 'find equipment with no inspection history', items: INVENTORY, teams: TEAMS, generate,
    })

    expect(seen[0]?.prompt).toContain('last_inspected: null (never inspected)')
    expect(result.items.map((entry) => entry.item_id)).toEqual(['i-mic', 'i-fresnel'])
    expect(result.items.every((entry) => !entry.last_inspected_at)).toBe(true)
    expect(result.answer).toMatch(/no inspection history/)
    expect(result.reasons.get('i-mic')).toBe('never inspected')
  })

  it('answers a condition question with the record that is in that condition', async () => {
    const { generate } = stub(JSON.stringify({
      answer: 'All six Fresnel lanterns are unusable.',
      matches: [{ inventory_ref: 'I2', reason: 'all six are unusable' }],
    }))

    const result = await askInventoryQuestion({
      query: 'what unusable lighting equipment do we have?',
      items: INVENTORY, teams: TEAMS, generate,
    })

    expect(result.items.map((entry) => entry.item_id)).toEqual(['i-fresnel'])
  })

  it('answers an availability question from the real quantities', async () => {
    const { generate } = stub(JSON.stringify({
      answer: 'The Fresnel lanterns have none available.',
      matches: [{ inventory_ref: 'I2' }],
      interpreted_filters: { availability: 'unavailable' },
    }))

    const result = await askInventoryQuestion({
      query: 'which equipment is currently unavailable?',
      items: INVENTORY, teams: TEAMS, generate,
    })

    expect(result.items[0]?.quantity_available).toBe(0)
    expect(result.resolved?.filters.availability).toBe('unavailable')
  })

  it('cannot show a record that was not supplied', async () => {
    const { generate } = stub(JSON.stringify({
      answer: 'We also have a fog machine.',
      matches: [{ inventory_ref: 'I1' }, { inventory_ref: 'I99' }],
    }))

    const result = await askInventoryQuestion({
      query: 'anything', items: INVENTORY, teams: TEAMS, generate,
    })

    expect(result.items).toHaveLength(1)
    expect(result.unknownRefs).toEqual(['I99'])
  })

  it('cannot smuggle a Firestore ID in place of a reference', async () => {
    const { generate } = stub(JSON.stringify({
      answer: 'Here it is.',
      matches: [{ inventory_ref: 'i-mic' }],
    }))

    const result = await askInventoryQuestion({
      query: 'anything', items: INVENTORY, teams: TEAMS, generate,
    })

    expect(result.items).toEqual([])
    expect(result.unknownRefs).toEqual(['i-mic'])
  })

  it('shows a repeated reference once', async () => {
    const { generate } = stub(JSON.stringify({
      answer: 'Here.',
      matches: [{ inventory_ref: 'I1' }, { inventory_ref: 'I1' }],
    }))

    const result = await askInventoryQuestion({
      query: 'anything', items: INVENTORY, teams: TEAMS, generate,
    })

    expect(result.items).toHaveLength(1)
  })

  it('keeps the sentence even when it names nothing', async () => {
    const { generate } = stub('{"answer":"Nothing here needs attention.","matches":[]}')
    const result = await askInventoryQuestion({
      query: 'anything need attention?', items: INVENTORY, teams: TEAMS, generate,
    })

    expect(result.answer).toBe('Nothing here needs attention.')
    expect(result.items).toEqual([])
  })

  it('sends no inventory block when the organization has none', async () => {
    const { generate, seen } = stub('{"answer":"You have no records yet.","matches":[]}')
    await askInventoryQuestion({ query: 'anything', items: [], teams: TEAMS, generate })

    expect(seen[0]?.prompt).toMatch(/none supplied/i)
  })
})

describe('Requirement Generator reads the inventory it was given', () => {
  const draftResponse = JSON.stringify({
    summary: 'Your mixing console and speakers look usable. Wireless microphone capacity is the'
      + ' likely gap for twenty vocalists.',
    suggestions: [
      {
        client_temp_id: 'tmp-1',
        item_name: 'Wireless Microphones',
        suggested_qty: 20,
        suggested_team_name: 'Sound',
        inventory_ref: 'I1',
        rationale: 'Twenty vocalists are specified.',
        suggested_action: 'rent',
      },
    ],
  })

  it('sends the inventory and returns an assessment with the draft', async () => {
    const { generate, seen } = stub(draftResponse)
    const outcome = await generateRequirementDraft({
      production: PRODUCTION, teams: TEAMS, existingItemNames: [], userPrompt: '',
      items: INVENTORY, canReadInventory: true, generate,
    })

    expect(seen[0]?.prompt).toContain('I1 | Shure BLX Wireless Microphone')
    expect(outcome.summary).toMatch(/likely gap/)
    expect(outcome.suggestions).toHaveLength(1)
    expect(outcome.generalGuidanceOnly).toBe(false)
  })

  it('links a suggestion through the reference it was given', async () => {
    const { generate } = stub(draftResponse)
    const outcome = await generateRequirementDraft({
      production: PRODUCTION, teams: TEAMS, existingItemNames: [], userPrompt: '',
      items: INVENTORY, canReadInventory: true, generate,
    })

    const [draft] = buildSuggestionDrafts(outcome.suggestions, {
      teams: TEAMS, allowedTeamIds: ALL_TEAM_IDS, items: INVENTORY,
      inventoryContext: outcome.context,
    })

    expect(draft?.inventoryItemId).toBe('i-mic')
    expect(draft?.refWasUnknown).toBe(false)
  })

  it('computes available and shortage from the real record, not the model', async () => {
    const { generate } = stub(draftResponse)
    const outcome = await generateRequirementDraft({
      production: PRODUCTION, teams: TEAMS, existingItemNames: [], userPrompt: '',
      items: INVENTORY, canReadInventory: true, generate,
    })

    const [draft] = buildSuggestionDrafts(outcome.suggestions, {
      teams: TEAMS, allowedTeamIds: ALL_TEAM_IDS, items: INVENTORY,
      inventoryContext: outcome.context,
    })

    // 20 needed against 8 genuinely available, with the two in service not
    // subtracted a second time.
    expect(draftFacts(draft!, INVENTORY)).toEqual({
      matched: INVENTORY[0], available: 8, shortage: 12,
    })
  })

  it('recomputes the shortage when the reviewer edits the quantity', async () => {
    const draft = { inventoryItemId: 'i-mic', requiredQty: 4 }
    expect(draftFacts(draft, INVENTORY).shortage).toBe(0)
    expect(draftFacts({ ...draft, requiredQty: 30 }, INVENTORY).shortage).toBe(22)
  })

  it('leaves a suggestion unmatched when the reference was never supplied', async () => {
    const { generate } = stub(JSON.stringify({
      summary: 'x',
      suggestions: [{
        client_temp_id: 'a', item_name: 'Fog Machine', suggested_qty: 1, inventory_ref: 'I99',
      }],
    }))

    const outcome = await generateRequirementDraft({
      production: PRODUCTION, teams: TEAMS, existingItemNames: [], userPrompt: '',
      items: INVENTORY, canReadInventory: true, generate,
    })

    const [draft] = buildSuggestionDrafts(outcome.suggestions, {
      teams: TEAMS, allowedTeamIds: ALL_TEAM_IDS, items: INVENTORY,
      inventoryContext: outcome.context,
    })

    expect(draft?.inventoryItemId).toBeNull()
    expect(draft?.refWasUnknown).toBe(true)
    expect(draftFacts(draft!, INVENTORY).shortage).toBeNull()
  })

  it('cannot link through a Firestore ID offered as a reference', async () => {
    const { generate } = stub(JSON.stringify({
      summary: 'x',
      suggestions: [{
        client_temp_id: 'a', item_name: 'Mics', suggested_qty: 1, inventory_ref: 'i-mic',
      }],
    }))

    const outcome = await generateRequirementDraft({
      production: PRODUCTION, teams: TEAMS, existingItemNames: [], userPrompt: '',
      items: INVENTORY, canReadInventory: true, generate,
    })

    const [draft] = buildSuggestionDrafts(outcome.suggestions, {
      teams: TEAMS, allowedTeamIds: ALL_TEAM_IDS, items: INVENTORY,
      inventoryContext: outcome.context,
    })

    expect(draft?.inventoryItemId).toBeNull()
  })

  it('keeps the suggested action out of the save payload', async () => {
    const { generate } = stub(draftResponse)
    const outcome = await generateRequirementDraft({
      production: PRODUCTION, teams: TEAMS, existingItemNames: [], userPrompt: '',
      items: INVENTORY, canReadInventory: true, generate,
    })

    const [draft] = buildSuggestionDrafts(outcome.suggestions, {
      teams: TEAMS, allowedTeamIds: ALL_TEAM_IDS, items: INVENTORY,
      inventoryContext: outcome.context,
    })

    expect(draft?.suggestedAction).toBe('rent')

    // Decision 48 stands: the plan lives on the Action Item alone.
    const inputs = toRequirementInputs([{ ...draft!, accepted: true }], ALL_TEAM_IDS)
    expect(Object.keys(inputs[0] ?? {}).sort())
      .toEqual(['inventoryItemId', 'itemName', 'notes', 'requiredQty', 'teamId'])
  })

  it('still saves nothing until a person accepts it', async () => {
    const { generate } = stub(draftResponse)
    const outcome = await generateRequirementDraft({
      production: PRODUCTION, teams: TEAMS, existingItemNames: [], userPrompt: '',
      items: INVENTORY, canReadInventory: true, generate,
    })

    const drafts = buildSuggestionDrafts(outcome.suggestions, {
      teams: TEAMS, allowedTeamIds: ALL_TEAM_IDS, items: INVENTORY,
      inventoryContext: outcome.context,
    })

    expect(toRequirementInputs(drafts, ALL_TEAM_IDS)).toEqual([])
  })
})

describe('without inventory permission', () => {
  const generalResponse = JSON.stringify({
    summary: 'A production of this size normally needs vocal reinforcement and area lighting.',
    suggestions: [{ client_temp_id: 'a', item_name: 'Wireless Microphones', suggested_qty: 20 }],
  })

  it('reads nothing and sends no inventory', async () => {
    const { generate, seen } = stub(generalResponse)
    const outcome = await generateRequirementDraft({
      production: PRODUCTION, teams: TEAMS, existingItemNames: [], userPrompt: '',
      // The page passes an empty list, and the flag says why.
      items: [], canReadInventory: false, generate,
    })

    expect(seen[0]?.prompt).toMatch(/none supplied/i)
    expect(outcome.generalGuidanceOnly).toBe(true)
    expect(outcome.context.byRef.size).toBe(0)
  })

  it('leaves every suggestion unmatched', async () => {
    const { generate } = stub(generalResponse)
    const outcome = await generateRequirementDraft({
      production: PRODUCTION, teams: TEAMS, existingItemNames: [], userPrompt: '',
      items: [], canReadInventory: false, generate,
    })

    const drafts = buildSuggestionDrafts(outcome.suggestions, {
      teams: TEAMS, allowedTeamIds: ALL_TEAM_IDS, items: [],
      inventoryContext: outcome.context,
    })

    expect(drafts[0]?.inventoryItemId).toBeNull()
    expect(drafts[0]?.candidates).toEqual([])
  })

  it('ignores a reference even if the model produces one', async () => {
    // Nothing was supplied, so nothing can be referenced.
    const { generate } = stub(JSON.stringify({
      summary: 'x',
      suggestions: [{ client_temp_id: 'a', item_name: 'Mics', suggested_qty: 2, inventory_ref: 'I1' }],
    }))

    const outcome = await generateRequirementDraft({
      production: PRODUCTION, teams: TEAMS, existingItemNames: [], userPrompt: '',
      items: [], canReadInventory: false, generate,
    })

    const [draft] = buildSuggestionDrafts(outcome.suggestions, {
      teams: TEAMS, allowedTeamIds: ALL_TEAM_IDS, items: [],
      inventoryContext: outcome.context,
    })

    expect(draft?.inventoryItemId).toBeNull()
    expect(draft?.refWasUnknown).toBe(true)
  })
})

describe('context size policy', () => {
  it('does not silently lose records when it has to cut', async () => {
    const many = Array.from({ length: 400 }, (_, index) =>
      item({ item_id: `i-${index}`, name: `Item ${index}` }))

    const context = buildInventoryContext({ items: many, teams: TEAMS })
    expect(context.omittedCount).toBe(150)

    const { generate } = stub('{"answer":"ok","matches":[]}')
    const result = await askInventoryQuestion({
      query: 'anything', items: many, teams: TEAMS, generate,
    })

    // The count reaches the UI, which tells the user the answer may not cover
    // everything.
    expect(result.omittedCount).toBe(150)
  })
})
