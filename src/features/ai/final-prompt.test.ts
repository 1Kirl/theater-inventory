import { describe, expect, it } from 'vitest'
import { askInventoryQuestion } from '@/features/ai/smart-search-service'
import { EMPTY_CONDITION_COUNTS } from '@/domain/inventory'
import type { AiGenerate } from '@/features/ai/ai-client'
import type { InventoryItem, InventoryUnit, UnitCounts } from '@/types/inventory'
import type { TheaterTeam } from '@/types/organization'

/**
 * What actually reaches the model.
 *
 * The earlier tests stop at the serializers, which proved the right sentence
 * could be built and not that it survives to the request. This captures the
 * payload at the injection point the SDK is called through — the last thing
 * before Gemini — so a fact that is present here is a fact the model received.
 *
 * Every live failure this suite exists for was a question of "did the model get
 * told", and no test answered it.
 */

const TEAMS: TheaterTeam[] = [
  { team_id: 'team-sound', name: 'Sound' } as TheaterTeam,
  { team_id: 'team-lighting', name: 'Lighting' } as TheaterTeam,
]

function counts(overrides: Partial<UnitCounts> = {}): UnitCounts {
  return {
    active_total: 3, available: 2, unusable_on_hand: 0, in_use: 0,
    in_maintenance: 1, lost: 0, retired: 0,
    ...overrides,
  } as UnitCounts
}

function item(overrides: Partial<InventoryItem> = {}): InventoryItem {
  return {
    item_id: 'item-mic',
    organization_id: 'org-a',
    name: 'Wireless Handheld',
    category: 'Microphones',
    team_id: 'team-sound',
    tracking_mode: 'serialized',
    unit_counts: counts(),
    quantity_total: 3,
    quantity_available: 2,
    condition_counts: { ...EMPTY_CONDITION_COUNTS, good: 3 },
    location: 'Booth',
    ...overrides,
  } as InventoryItem
}

function unit(overrides: Partial<InventoryUnit> = {}): InventoryUnit {
  return {
    unit_id: 'u1',
    organization_id: 'org-a',
    inventory_item_id: 'item-mic',
    asset_code: 'MIC-001',
    team_id: 'team-sound',
    status: 'available',
    condition: 'good',
    storage_location: 'Booth shelf B',
    ...overrides,
  } as InventoryUnit
}

/** A valid, minimal model response, so the call completes and the prompt lands. */
const ANSWER = JSON.stringify({ answer: 'Checked.', matches: [] })

/** Runs the real service and returns the exact request it would have sent. */
async function capture(params: {
  query: string
  items: readonly InventoryItem[]
  units?: readonly InventoryUnit[]
}) {
  let seen = { prompt: '', systemInstruction: '' }

  const generate: AiGenerate = async (request) => {
    seen = {
      prompt: request.prompt,
      systemInstruction: request.systemInstruction ?? '',
    }
    return { text: ANSWER, truncated: false }
  }

  await askInventoryQuestion({
    query: params.query,
    items: params.items,
    ...(params.units ? { units: params.units } : {}),
    teams: TEAMS,
    generate,
  })

  return { ...seen, whole: `${seen.systemInstruction}\n${seen.prompt}` }
}

describe('asking whether anything has planned maintenance', () => {
  const QUERY = 'Do we have any equipment with planned maintenance?'

  const noPlan = unit({ unit_id: 'u1', asset_code: 'MIC-001' })
  const planned = unit({
    unit_id: 'u2', asset_code: 'MIC-002', status: 'available',
    planned_maintenance_record_id: 'plan-1',
  } as Partial<InventoryUnit>)
  const away = unit({
    unit_id: 'u3', asset_code: 'MIC-003', status: 'in_maintenance',
    current_maintenance_record_id: 'rec-1',
  } as Partial<InventoryUnit>)

  it('sends the planned equipment to the model', async () => {
    // The live failure said the application does not track planned maintenance.
    // This is the assertion that would have caught it.
    const { prompt } = await capture({
      query: QUERY, items: [item()], units: [noPlan, planned, away],
    })

    expect(prompt).toContain('MIC-002')
    expect(prompt).toContain('planned maintenance scheduled (advisory, not yet away)')
  })

  it('does not label equipment that merely went for repair as planned', async () => {
    const { prompt } = await capture({
      query: QUERY, items: [item()], units: [noPlan, planned, away],
    })

    const lines = prompt.split('\n')
    const mic003 = lines.find((l) => l.includes('MIC-003')) ?? ''
    const mic001 = lines.find((l) => l.includes('MIC-001')) ?? ''

    expect(mic003).toContain('currently away for repair')
    expect(mic003).not.toContain('planned maintenance scheduled')
    expect(mic001).not.toContain('planned maintenance scheduled')
  })

  it('keeps planned and away distinguishable on the same equipment', async () => {
    const both = unit({
      unit_id: 'u4', asset_code: 'MIC-004', status: 'in_use',
      using_team_id: 'team-lighting', planned_maintenance_record_id: 'plan-2',
    } as Partial<InventoryUnit>)

    const { prompt } = await capture({ query: QUERY, items: [item()], units: [both] })
    const line = prompt.split('\n').find((l) => l.includes('MIC-004')) ?? ''

    expect(line).toContain('planned maintenance scheduled')
    expect(line).toContain('checked out to team Lighting')
    expect(line).not.toContain('currently away for repair')
  })

  it('tells the model what the words mean', async () => {
    const { whole } = await capture({ query: QUERY, items: [item()], units: [planned] })

    expect(whole).toContain('is an intention, not a repair')
    expect(whole).toContain('never add it to a count of equipment in')
  })
})

describe('asking what something costs', () => {
  const QUERY = 'What is the estimated unit cost of Wireless Handheld?'

  it('sends a stored price to the model', async () => {
    // The second live failure: an item with a recorded cost was reported as
    // having none.
    const { prompt } = await capture({
      query: QUERY, items: [item({ unit_cost_cents: 24900 })],
    })

    expect(prompt).toContain('estimated unit cost $249.00')
    expect(prompt).not.toContain('estimated unit cost unknown')
  })

  it('sends unknown as unknown, never as free', async () => {
    const { prompt } = await capture({ query: QUERY, items: [item()] })

    expect(prompt).toContain('estimated unit cost unknown')
    expect(prompt).not.toContain('$0.00')
  })

  it('sends a deliberate zero as zero', async () => {
    const { prompt } = await capture({
      query: QUERY, items: [item({ unit_cost_cents: 0 })],
    })

    expect(prompt).toContain('estimated unit cost $0.00')
    expect(prompt).not.toContain('estimated unit cost unknown')
  })

  it('keeps two items with different cost states apart', async () => {
    const { prompt } = await capture({
      query: 'what do things cost',
      items: [
        item({ item_id: 'a', name: 'Wireless Handheld', unit_cost_cents: 24900 }),
        item({ item_id: 'b', name: 'XLR Cable' }),
      ],
    })

    const lines = prompt.split('\n')
    expect(lines.find((l) => l.includes('Wireless Handheld'))).toContain('$249.00')
    expect(lines.find((l) => l.includes('XLR Cable'))).toContain('unknown')
  })

  it('tells the model never to guess a missing one', async () => {
    const { whole } = await capture({ query: QUERY, items: [item()] })

    expect(whole).toContain('never guess a price')
    expect(whole).toContain('never treat unknown as zero')
  })
})

describe('what the request carries in general', () => {
  it('carries the equipment block whenever there is equipment', async () => {
    const { prompt } = await capture({
      query: 'anything', items: [item()], units: [unit()],
    })

    expect(prompt).toContain('EQUIPMENT_DATA')
    expect(prompt).toContain('asset code MIC-001')
    expect(prompt).toContain('authoritative record')
  })

  it('omits the equipment block for an organization with none', async () => {
    const { prompt } = await capture({ query: 'anything', items: [item()] })

    expect(prompt).not.toContain('EQUIPMENT_DATA')
    expect(prompt).toContain('INVENTORY_DATA')
  })

  it('carries the user question, delimited as data', async () => {
    const { prompt } = await capture({ query: 'where is MIC-001', items: [item()] })

    expect(prompt).toContain('<<<USER_QUERY')
    expect(prompt).toContain('where is MIC-001')
    expect(prompt).toContain('USER_QUERY>>>')
  })

  it('never carries a document id', async () => {
    const { prompt } = await capture({
      query: 'anything',
      items: [item({ item_id: 'itemSECRETAAAAAAAAAA' })],
      units: [unit({ unit_id: 'unitSECRETAAAAAAAAAA' })],
    })

    expect(prompt).not.toContain('itemSECRET')
    expect(prompt).not.toContain('unitSECRET')
  })

  it('states availability rather than leaving it to be inferred', async () => {
    const { prompt } = await capture({
      query: 'what is available',
      items: [item()],
      units: [unit({ status: 'available', condition: 'needs_repair' })],
    })

    // Equipment needing repair is still on the shelf. The prompt says so twice:
    // on the line, and in the instructions.
    expect(prompt).toContain('available yes')
  })
})
