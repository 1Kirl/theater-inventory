import { describe, expect, it } from 'vitest'
import { generateRequirementDraft } from '@/features/ai/requirement-generator-service'
import { buildProductionPlan } from '@/domain/production-planning'
import { EMPTY_CONDITION_COUNTS } from '@/domain/inventory'
import type { AiGenerate } from '@/features/ai/ai-client'
import type { InventoryItem } from '@/types/inventory'
import type { ActionItem, Production, ProductionRequirement } from '@/types/production'
import type { TheaterTeam } from '@/types/organization'

/**
 * Draft Requirements, at the boundary where it actually matters.
 *
 * Two things are checked here and nowhere else: that the facts the assistant
 * needs are in the request, and that nothing it sends back can become a card
 * unless the application already had the record. Everything else about the
 * feature is advice, and advice that rests on invented evidence is worse than
 * no advice.
 */

const TEAMS: TheaterTeam[] = [{ team_id: 'team-sound', name: 'Sound' } as TheaterTeam]

const PRODUCTION = { title: 'Spring Musical', description: 'A large cast show.' } as Production

function item(overrides: Partial<InventoryItem> = {}): InventoryItem {
  return {
    item_id: 'item-cable',
    organization_id: 'org-a',
    name: 'XLR Cable',
    category: 'Cables',
    team_id: 'team-sound',
    tracking_mode: 'bulk',
    quantity_total: 14,
    quantity_available: 12,
    condition_counts: { ...EMPTY_CONDITION_COUNTS, good: 14 },
    location: 'Booth',
    ...overrides,
  } as InventoryItem
}

function requirement(overrides: Partial<ProductionRequirement> = {}): ProductionRequirement {
  return {
    requirement_id: 'req-1',
    organization_id: 'org-a',
    production_id: 'prod-1',
    item_name: 'XLR Cable',
    inventory_item_id: 'item-cable',
    required_qty: 20,
    team_id: 'team-sound',
    source: 'manual',
    ...overrides,
  } as ProductionRequirement
}

function action(overrides: Partial<ActionItem> = {}): ActionItem {
  return {
    action_item_id: 'req-1',
    organization_id: 'org-a',
    production_id: 'prod-1',
    requirement_id: 'req-1',
    item_name: 'XLR Cable',
    action_type: 'buy',
    quantity: 20,
    team_id: 'team-sound',
    status: 'todo',
    ...overrides,
  } as ActionItem
}

const ONE_SUGGESTION = {
  client_temp_id: 'tmp-1',
  item_name: 'XLR Cable',
  suggested_qty: 20,
}

/** Runs the real service, capturing the request and steering the reply. */
async function run(params: {
  items: readonly InventoryItem[]
  requirements?: readonly ProductionRequirement[]
  actions?: readonly ActionItem[]
  canReadInventory?: boolean
  userPrompt?: string
  reply?: Record<string, unknown>
}) {
  let prompt = ''
  let systemInstruction = ''

  const generate: AiGenerate = async (request) => {
    prompt = request.prompt
    systemInstruction = request.systemInstruction ?? ''
    return {
      text: JSON.stringify(params.reply ?? { summary: 'ok', suggestions: [ONE_SUGGESTION] }),
      truncated: false,
    }
  }

  const canRead = params.canReadInventory ?? true
  const plan = canRead
    ? buildProductionPlan({
      requirements: params.requirements ?? [],
      items: params.items,
      actions: params.actions ?? [],
    })
    : null

  const outcome = await generateRequirementDraft({
    production: PRODUCTION,
    teams: TEAMS,
    existingItemNames: [],
    userPrompt: params.userPrompt ?? 'I need 20 XLR cables.',
    items: params.items,
    canReadInventory: canRead,
    plan,
    generate,
  })

  // The instruction is a wrapped template literal, so a phrase a reader sees as
  // one sentence can straddle a newline. Assertions read the flowed text.
  const flow = (text: string) => text.replace(/\s+/g, ' ')

  return {
    prompt,
    systemInstruction: flow(systemInstruction),
    outcome,
    whole: flow(`${systemInstruction}\n${prompt}`),
  }
}

describe('planning a new need against what they own', () => {
  it('sends the shortage and its cost, already worked out', async () => {
    // Twenty needed, twelve owned, eight short at $18.50 is $148.00. All four
    // numbers are the application's; the model only repeats them.
    const { prompt } = await run({
      items: [item({ quantity_available: 12, unit_cost_cents: 1850 })],
      requirements: [requirement({ required_qty: 20 })],
    })

    expect(prompt).toContain('required 20')
    expect(prompt).toContain('available 12')
    expect(prompt).toContain('shortage 8')
    expect(prompt).toContain('stored unit cost $18.50')
    expect(prompt).toContain('known cost to cover the shortage $148.00')
  })

  it('tells the model the shortage is what needs acquiring, not the requirement', async () => {
    const { systemInstruction } = await run({ items: [item()] })

    expect(systemInstruction).toContain('the shortage is what')
    expect(systemInstruction).toContain('never the whole required quantity')
  })

  it('forbids recalculating what it was given', async () => {
    const { systemInstruction } = await run({ items: [item()] })

    expect(systemInstruction).toContain('calculated by the application')
    expect(systemInstruction).toContain('do not recalculate them')
  })
})

describe('a purchase that outgrew its shortage', () => {
  it('sends the mismatch and the saving', async () => {
    const { prompt } = await run({
      items: [item({ name: '4x8 Platform', quantity_available: 10, unit_cost_cents: 10000 })],
      requirements: [requirement({ item_name: '4x8 Platform', required_qty: 20 })],
      actions: [action({ quantity: 20, estimated_unit_cost_cents: 10000 })],
      userPrompt: 'Can I reduce the cost of what I have planned?',
    })

    expect(prompt).toContain('shortage 10')
    expect(prompt).toContain('buy 20')
    expect(prompt).toContain('action estimated cost $2,000.00')
    expect(prompt).toContain('action plans 10 more than the current shortage')
    expect(prompt).toContain('known possible saving $1,000.00')
  })

  it('explains that an action quantity is a snapshot', async () => {
    const { systemInstruction } = await run({ items: [item()] })

    expect(systemInstruction).toContain('snapshot')
    expect(systemInstruction).toContain('does not follow the shelf')
  })
})

describe('a shortage nobody has priced', () => {
  it('sends the quantity and refuses to price it', async () => {
    const { prompt } = await run({
      items: [item({ quantity_available: 12 })],
      requirements: [requirement({ required_qty: 20 })],
    })

    expect(prompt).toContain('shortage 8')
    expect(prompt).toContain('stored unit cost unknown')
    expect(prompt).not.toContain('known cost to cover the shortage')
  })

  it('forbids guessing one', async () => {
    const { systemInstruction } = await run({ items: [item()] })

    expect(systemInstruction).toContain('Never estimate a price')
    expect(systemInstruction).toContain('never treat unknown as zero')
  })
})

describe('an item recorded as free', () => {
  it('is sent as zero, which is not unknown', async () => {
    const { prompt } = await run({
      items: [item({ quantity_available: 12, unit_cost_cents: 0 })],
      requirements: [requirement({ required_qty: 20 })],
    })

    expect(prompt).toContain('stored unit cost $0.00')
    expect(prompt).toContain('known cost to cover the shortage $0.00')
  })
})

describe('what the model may turn into a card', () => {
  it('resolves a reference the request actually supplied', async () => {
    const { outcome } = await run({
      items: [item()],
      reply: {
        summary: 'You already own most of these.',
        suggestions: [ONE_SUGGESTION],
        inventory_refs: ['I1'],
      },
    })

    expect(outcome.relatedItems).toHaveLength(1)
    expect(outcome.relatedItems[0]?.item_id).toBe('item-cable')
    // The card is the application's record, not anything the model wrote.
    expect(outcome.relatedItems[0]?.quantity_available).toBe(12)
  })

  it('produces nothing for a reference that was never supplied', async () => {
    // The protection that matters: a model naming FAKE99 must not put a card
    // on screen, however confident its sentence was.
    const { outcome } = await run({
      items: [item()],
      reply: {
        summary: 'We found 500 cables.',
        suggestions: [ONE_SUGGESTION],
        inventory_refs: ['FAKE99', 'I99', 'itemSECRETAAAAAAAAAA'],
      },
    })

    expect(outcome.relatedItems).toEqual([])
  })

  it('ignores quantities and prices the model tries to attach to a finding', async () => {
    const { outcome } = await run({
      items: [item({ quantity_available: 12, unit_cost_cents: 1850 })],
      requirements: [requirement({ required_qty: 20 })],
      reply: {
        summary: 'ok',
        suggestions: [ONE_SUGGESTION],
        planning_findings: [{
          message: 'You have plenty.',
          requirement_ref: 'R1',
          available: 999,
          unit_cost_cents: 999999,
          saving: '$1,000,000',
        }],
      },
    })

    // strictObject refuses the row outright rather than stripping the extras,
    // so nothing invented reaches the screen.
    expect(outcome.findings).toEqual([])
  })

  it('keeps a well-formed finding and attaches the real record to it', async () => {
    const { outcome } = await run({
      items: [item({ name: '4x8 Platform', quantity_available: 10, unit_cost_cents: 10000 })],
      requirements: [requirement({ item_name: '4x8 Platform', required_qty: 20 })],
      actions: [action({ quantity: 20, estimated_unit_cost_cents: 10000 })],
      reply: {
        summary: 'ok',
        suggestions: [ONE_SUGGESTION],
        planning_findings: [{
          message: 'The planned purchase is larger than the current shortage.',
          requirement_ref: 'R1',
          inventory_ref: 'I1',
        }],
      },
    })

    expect(outcome.findings).toHaveLength(1)
    const finding = outcome.findings[0]

    expect(finding?.message).toContain('larger than the current shortage')
    // Every number beside the message comes from here, not from the model.
    expect(finding?.requirement?.shortage).toBe(10)
    expect(finding?.requirement?.excessQuantity).toBe(10)
    expect(finding?.requirement?.potentialSavingsCents).toBe(100_000)
    expect(finding?.item?.item_id).toBe('item-cable')
  })

  it('keeps the message when its references point at nothing', async () => {
    // A remark can still be worth reading without evidence attached; it simply
    // arrives with no card and no numbers.
    const { outcome } = await run({
      items: [item()],
      reply: {
        summary: 'ok',
        suggestions: [ONE_SUGGESTION],
        planning_findings: [{ message: 'Consider renting.', requirement_ref: 'R9' }],
      },
    })

    expect(outcome.findings).toHaveLength(1)
    expect(outcome.findings[0]?.requirement).toBeNull()
    expect(outcome.findings[0]?.item).toBeNull()
  })
})

describe('somebody who may plan a production but not see the inventory', () => {
  it('is not given any inventory to reason over', async () => {
    const { prompt } = await run({
      items: [item({ quantity_available: 12, unit_cost_cents: 1850 })],
      requirements: [requirement()],
      actions: [action()],
      canReadInventory: false,
    })

    expect(prompt).not.toContain('XLR Cable')
    expect(prompt).not.toContain('$18.50')
    expect(prompt).not.toContain('available 12')
    expect(prompt).not.toContain('PLAN_DATA')
    expect(prompt).toContain('none supplied')
  })

  it('gets no cards either, so it cannot appear to have looked', async () => {
    const { outcome } = await run({
      items: [item()],
      canReadInventory: false,
      reply: {
        summary: 'You have 12 cables.',
        suggestions: [ONE_SUGGESTION],
        inventory_refs: ['I1'],
      },
    })

    expect(outcome.relatedItems).toEqual([])
    expect(outcome.generalGuidanceOnly).toBe(true)
  })
})

describe('the write boundary', () => {
  it('returns drafts and remarks, and changes nothing', async () => {
    const { outcome } = await run({
      items: [item()],
      requirements: [requirement()],
      actions: [action()],
      reply: {
        summary: 'ok',
        suggestions: [ONE_SUGGESTION],
        planning_findings: [{ message: 'Reduce the purchase.', requirement_ref: 'R1' }],
      },
    })

    // Everything is a value handed back for a person to act on. There is no
    // path from here to a write.
    expect(outcome.suggestions).toHaveLength(1)
    expect(outcome.findings).toHaveLength(1)
    expect(Object.keys(outcome)).not.toContain('applied')
    expect(Object.keys(outcome)).not.toContain('saved')
  })

  it('states in the prompt that nothing it returns changes a record', async () => {
    const { systemInstruction } = await run({ items: [item()] })
    expect(systemInstruction).toContain('nothing you return changes any record')
  })
})
