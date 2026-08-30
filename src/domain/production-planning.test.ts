import { describe, expect, it } from 'vitest'
import {
  buildProductionPlan, planBlock, serializeRequirementPlan,
} from '@/domain/production-planning'
import { formatCents } from '@/domain/money'
import { EMPTY_CONDITION_COUNTS } from '@/domain/inventory'
import type { InventoryItem } from '@/types/inventory'
import type { ActionItem, ProductionRequirement } from '@/types/production'

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
    quantity: 8,
    team_id: 'team-sound',
    status: 'todo',
    ...overrides,
  } as ActionItem
}

const only = (plan: ReturnType<typeof buildProductionPlan>) => plan.requirements[0]

/** A requirement nobody has pointed at an inventory record. */
function unmatchedRequirement(): ProductionRequirement {
  const { inventory_item_id: _omitted, ...rest } = requirement()
  return rest as ProductionRequirement
}

describe('a requirement the inventory partly covers', () => {
  const plan = buildProductionPlan({
    requirements: [requirement({ required_qty: 20 })],
    items: [item({ quantity_available: 12, unit_cost_cents: 1850 })],
    actions: [],
  })

  it('works out what is short rather than what is needed', () => {
    // The whole point: twenty are needed, twelve are owned, eight are short.
    // A plan that recommended buying twenty would waste $222.
    expect(only(plan)?.requiredQty).toBe(20)
    expect(only(plan)?.availableQty).toBe(12)
    expect(only(plan)?.shortage).toBe(8)
  })

  it('prices the shortage from the stored estimate, not the requirement', () => {
    expect(formatCents(only(plan)?.knownShortageCostCents ?? -1)).toBe('$148.00')
  })

  it('says all of it on one line the model can only repeat', () => {
    const line = serializeRequirementPlan(only(plan)!)

    expect(line).toContain('required 20')
    expect(line).toContain('available 12')
    expect(line).toContain('shortage 8')
    expect(line).toContain('stored unit cost $18.50')
    expect(line).toContain('known cost to cover the shortage $148.00')
  })
})

describe('a requirement matched to nothing', () => {
  const plan = buildProductionPlan({
    // An unmatched requirement carries no inventory pointer at all: the key is
    // absent, not set to undefined.
    requirements: [unmatchedRequirement()],
    items: [item()],
    actions: [],
  })

  it('reports unknown availability, never zero', () => {
    // Not matched and none available are different facts. Collapsing them would
    // have the assistant recommending a purchase for equipment the program may
    // already own under another name.
    expect(only(plan)?.matched).toBe(false)
    expect(only(plan)?.availableQty).toBeNull()
    expect(only(plan)?.shortage).toBeNull()
    expect(only(plan)?.knownShortageCostCents).toBeNull()
  })

  it('says so in words', () => {
    const line = serializeRequirementPlan(only(plan)!)
    expect(line).toContain('not matched')
    expect(line).toContain('availability is unknown')
    expect(line).not.toContain('shortage 0')
  })
})

describe('a purchase nobody revisited', () => {
  // Twenty platforms required, ten now on the shelf, and a Buy for twenty
  // planned back when none were.
  const plan = buildProductionPlan({
    requirements: [requirement({ item_name: '4x8 Platform', required_qty: 20 })],
    items: [item({ name: '4x8 Platform', quantity_available: 10, unit_cost_cents: 10000 })],
    actions: [action({ quantity: 20, estimated_unit_cost_cents: 10000 })],
  })

  it('sees that the shortage has fallen below the planned purchase', () => {
    expect(only(plan)?.shortage).toBe(10)
    expect(only(plan)?.action?.quantity).toBe(20)
    expect(only(plan)?.excessQuantity).toBe(10)
  })

  it('prices what giving it back would save', () => {
    expect(formatCents(only(plan)?.potentialSavingsCents ?? -1)).toBe('$1,000.00')
    expect(formatCents(plan.knownPotentialSavingsCents)).toBe('$1,000.00')
    expect(plan.overplannedCount).toBe(1)
  })

  it('still reports what the action currently costs', () => {
    expect(formatCents(only(plan)?.action?.estimatedTotalCents ?? -1)).toBe('$2,000.00')
  })

  it('puts the mismatch in the line, so the model can explain it', () => {
    const line = serializeRequirementPlan(only(plan)!)

    expect(line).toContain('shortage 10')
    expect(line).toContain('buy 20')
    expect(line).toContain('action plans 10 more than the current shortage')
    expect(line).toContain('known possible saving $1,000.00')
  })
})

describe('a requirement the inventory now covers entirely', () => {
  const plan = buildProductionPlan({
    requirements: [requirement({ required_qty: 10 })],
    items: [item({ quantity_available: 10, unit_cost_cents: 1850 })],
    actions: [action({ quantity: 5, estimated_unit_cost_cents: 1850 })],
  })

  it('reports no shortage and the whole purchase as excess', () => {
    expect(only(plan)?.shortage).toBe(0)
    expect(only(plan)?.excessQuantity).toBe(5)
    expect(formatCents(only(plan)?.potentialSavingsCents ?? -1)).toBe('$92.50')
    expect(plan.coveredCount).toBe(1)
  })
})

describe('work already decided against', () => {
  it('is not counted as excess, because it is not happening', () => {
    const plan = buildProductionPlan({
      requirements: [requirement({ required_qty: 20 })],
      items: [item({ quantity_available: 20 })],
      actions: [action({ quantity: 20, status: 'cancelled', estimated_unit_cost_cents: 1850 })],
    })

    expect(only(plan)?.excessQuantity).toBeNull()
    expect(plan.knownPotentialSavingsCents).toBe(0)
    expect(plan.overplannedCount).toBe(0)
  })

  it('but completed work still counts, because it was still bought', () => {
    const plan = buildProductionPlan({
      requirements: [requirement({ required_qty: 20 })],
      items: [item({ quantity_available: 20 })],
      actions: [action({ quantity: 20, status: 'done', estimated_unit_cost_cents: 1850 })],
    })

    expect(only(plan)?.excessQuantity).toBe(20)
  })
})

describe('a shortage nobody has priced', () => {
  const plan = buildProductionPlan({
    requirements: [requirement({ required_qty: 20 })],
    items: [item({ quantity_available: 12 })],
    actions: [],
  })

  it('still works out the quantity', () => {
    expect(only(plan)?.shortage).toBe(8)
  })

  it('refuses to price it, rather than guessing or calling it free', () => {
    expect(only(plan)?.unitCostCents).toBeNull()
    expect(only(plan)?.knownShortageCostCents).toBeNull()

    const line = serializeRequirementPlan(only(plan)!)
    expect(line).toContain('stored unit cost unknown')
    expect(line).not.toContain('$0.00')
  })
})

describe('an item somebody recorded as free', () => {
  it('is priced at zero, which is not unknown', () => {
    const plan = buildProductionPlan({
      requirements: [requirement({ required_qty: 20 })],
      items: [item({ quantity_available: 12, unit_cost_cents: 0 })],
      actions: [],
    })

    const line = serializeRequirementPlan(only(plan)!)
    expect(line).toContain('stored unit cost $0.00')
    expect(line).not.toContain('unknown')
    expect(only(plan)?.knownShortageCostCents).toBe(0)
  })
})

describe('pointing the model at the inventory record', () => {
  it('carries the reference the context gave that item', () => {
    const plan = buildProductionPlan({
      requirements: [requirement()],
      items: [item()],
      actions: [],
      inventoryRefs: new Map([['item-cable', 'I3']]),
    })

    expect(only(plan)?.inventoryRef).toBe('I3')
    expect(serializeRequirementPlan(only(plan)!)).toContain('inventory I3')
  })

  it('says the record is absent rather than inventing a reference', () => {
    const plan = buildProductionPlan({
      requirements: [requirement()], items: [item()], actions: [],
    })

    expect(only(plan)?.inventoryRef).toBeNull()
    expect(serializeRequirementPlan(only(plan)!)).toContain('inventory not in this list')
  })

  it('never carries a document id', () => {
    const plan = buildProductionPlan({
      requirements: [requirement({
        requirement_id: 'reqSECRETAAAAAAAAAA', inventory_item_id: 'itemSECRETAAAAAAAAA',
      })],
      items: [item({ item_id: 'itemSECRETAAAAAAAAA' })],
      actions: [action({
        action_item_id: 'reqSECRETAAAAAAAAAA', requirement_id: 'reqSECRETAAAAAAAAAA',
      })],
    })

    const block = planBlock(plan)
    expect(block).not.toContain('SECRET')
    expect(block).toContain('R1')
    expect(block).toContain('A1')
  })
})

describe('a production with nothing planned yet', () => {
  it('says so plainly', () => {
    const plan = buildProductionPlan({ requirements: [], items: [item()], actions: [] })

    expect(plan.requirements).toEqual([])
    expect(plan.knownPotentialSavingsCents).toBe(0)
    expect(planBlock(plan)).toContain('no requirements yet')
  })
})

describe('several requirements at once', () => {
  it('adds up only the savings it can prove', () => {
    const plan = buildProductionPlan({
      requirements: [
        requirement({ requirement_id: 'r1', inventory_item_id: 'a', required_qty: 20 }),
        requirement({ requirement_id: 'r2', inventory_item_id: 'b', required_qty: 10 }),
        requirement({ requirement_id: 'r3', inventory_item_id: 'c', required_qty: 5 }),
      ],
      items: [
        item({ item_id: 'a', quantity_available: 20, unit_cost_cents: 10000 }),
        item({ item_id: 'b', quantity_available: 10 }),
        item({ item_id: 'c', quantity_available: 5, unit_cost_cents: 500 }),
      ],
      actions: [
        action({ requirement_id: 'r1', quantity: 20, estimated_unit_cost_cents: 10000 }),
        // Priced by nobody, so its excess cannot be turned into money.
        action({ requirement_id: 'r2', quantity: 10 }),
        action({ requirement_id: 'r3', quantity: 5, estimated_unit_cost_cents: 500 }),
      ],
    })

    expect(plan.overplannedCount).toBe(3)
    expect(plan.coveredCount).toBe(3)
    // $2,000 from the first and $25 from the third. The middle one is real
    // excess that simply cannot be priced, and is not guessed at.
    expect(formatCents(plan.knownPotentialSavingsCents)).toBe('$2,025.00')
  })

  it('tells the model the numbers are already worked out', () => {
    const plan = buildProductionPlan({
      requirements: [requirement()], items: [item()], actions: [],
    })

    const block = planBlock(plan)
    expect(block).toContain('calculated by the application')
    expect(block).toContain('do not recompute them')
    expect(block).toContain('PLAN_DATA')
  })
})
