import { describe, expect, it } from 'vitest'
import {
  COUNTED_ACTION_STATUSES, actionEstimateLabel, actionTypeTakesPrefill, costBreakdown,
  countsTowardCost, isCostEstimateComplete, missingCostNote, summarizeProductionCosts,
} from '@/domain/production-costs'
import { formatCents } from '@/domain/money'
import {
  ACTION_STATUSES, type ActionItem, type ActionStatus, type ActionType,
} from '@/types/production'

function action(overrides: Partial<ActionItem> = {}): ActionItem {
  return {
    action_item_id: 'req-1',
    organization_id: 'org-a',
    production_id: 'prod-1',
    requirement_id: 'req-1',
    item_name: 'XLR Cable',
    action_type: 'buy',
    quantity: 1,
    team_id: 'team-sound',
    status: 'todo',
    ...overrides,
  } as ActionItem
}

describe('what a production is expected to cost', () => {
  it('adds up the estimates it has', () => {
    const summary = summarizeProductionCosts([
      action({ action_type: 'buy', quantity: 5, estimated_unit_cost_cents: 1850 }),
      action({ action_type: 'rent', quantity: 3, estimated_unit_cost_cents: 4000 }),
      action({ action_type: 'build', quantity: 2, estimated_unit_cost_cents: 6500 }),
      action({ action_type: 'repair', quantity: 1, estimated_unit_cost_cents: 7500 }),
    ])

    expect(formatCents(summary.knownTotalCents)).toBe('$417.50')
    expect(summary.estimatedCount).toBe(4)
    expect(summary.missingCount).toBe(0)
  })

  it('splits the same total by the kind of work, with nothing double counted', () => {
    const summary = summarizeProductionCosts([
      action({ action_type: 'buy', quantity: 5, estimated_unit_cost_cents: 1850 }),
      action({ action_type: 'buy', quantity: 10, estimated_unit_cost_cents: 5275 }),
      action({ action_type: 'rent', quantity: 3, estimated_unit_cost_cents: 4000 }),
      action({ action_type: 'build', quantity: 2, estimated_unit_cost_cents: 6500 }),
      action({ action_type: 'repair', quantity: 1, estimated_unit_cost_cents: 7500 }),
    ])

    expect(formatCents(summary.byType.buy)).toBe('$620.00')
    expect(formatCents(summary.byType.rent)).toBe('$120.00')
    expect(formatCents(summary.byType.build)).toBe('$130.00')
    expect(formatCents(summary.byType.repair)).toBe('$75.00')

    // The parts add to the whole, which is the point of one bucket per action.
    const parts = Object.values(summary.byType).reduce((sum, cents) => sum + cents, 0)
    expect(parts).toBe(summary.knownTotalCents)
    expect(formatCents(summary.knownTotalCents)).toBe('$945.00')
  })

  it('lists every kind of work even when nothing was spent on it', () => {
    const rows = costBreakdown(summarizeProductionCosts([
      action({ action_type: 'buy', quantity: 1, estimated_unit_cost_cents: 1000 }),
    ]))

    expect(rows.map((row) => row.type)).toEqual(['buy', 'rent', 'build', 'repair'])
    expect(rows.find((row) => row.type === 'rent')?.cents).toBe(0)
  })
})

describe('which work counts toward the estimate', () => {
  it('counts work still to do', () => {
    expect(countsTowardCost('todo')).toBe(true)
    expect(countsTowardCost('in_progress')).toBe(true)
  })

  it('counts work already done', () => {
    // The production still had to pay for the cable it already bought. Dropping
    // completed work would make the budget shrink as the season went on, which
    // is the opposite of what it is for.
    expect(countsTowardCost('done')).toBe(true)

    const summary = summarizeProductionCosts([
      action({ status: 'done', quantity: 5, estimated_unit_cost_cents: 1850 }),
    ])
    expect(formatCents(summary.knownTotalCents)).toBe('$92.50')
    expect(summary.estimatedCount).toBe(1)
  })

  it('leaves out work that was cancelled', () => {
    // Decided against, never paid for.
    expect(countsTowardCost('cancelled')).toBe(false)

    const summary = summarizeProductionCosts([
      action({ status: 'cancelled', quantity: 100, estimated_unit_cost_cents: 9999 }),
    ])
    expect(summary.knownTotalCents).toBe(0)
    expect(summary.estimatedCount).toBe(0)
    // Nor does a cancelled action without an estimate count as a gap.
    expect(summary.missingCount).toBe(0)
  })

  it('does not count a cancelled action as a missing estimate either', () => {
    const summary = summarizeProductionCosts([action({ status: 'cancelled' })])
    expect(summary.missingCount).toBe(0)
  })

  it('covers every status the product defines', () => {
    // If a status is ever added, this fails until somebody decides which side
    // of the estimate it belongs on.
    for (const status of ACTION_STATUSES) {
      expect(typeof countsTowardCost(status)).toBe('boolean')
    }
    expect([...COUNTED_ACTION_STATUSES].sort()).toEqual(['done', 'in_progress', 'todo'])
    const excluded = ACTION_STATUSES.filter((s) => !countsTowardCost(s))
    expect(excluded).toEqual(['cancelled'])
  })
})

describe('estimates that are missing', () => {
  it('reports them instead of quietly counting them as nothing', () => {
    const summary = summarizeProductionCosts([
      action({ quantity: 5, estimated_unit_cost_cents: 1850 }),
      action({ quantity: 3 }),
      action({ quantity: 2 }),
      action({ quantity: 1 }),
    ])

    expect(formatCents(summary.knownTotalCents)).toBe('$92.50')
    expect(summary.missingCount).toBe(3)
    expect(isCostEstimateComplete(summary)).toBe(false)
  })

  it('says so in words the person reading the total can act on', () => {
    const three = summarizeProductionCosts([
      action({ estimated_unit_cost_cents: 100 }), action(), action(), action(),
    ])
    expect(missingCostNote(three)).toContain('3 action items')
    expect(missingCostNote(three)).toContain('not included')

    const one = summarizeProductionCosts([action(), action({ estimated_unit_cost_cents: 100 })])
    expect(missingCostNote(one)).toContain('1 action item has')
  })

  it('says nothing when the total is the whole story', () => {
    const complete = summarizeProductionCosts([
      action({ quantity: 5, estimated_unit_cost_cents: 1850 }),
    ])
    expect(isCostEstimateComplete(complete)).toBe(true)
    expect(missingCostNote(complete)).toBeNull()
  })

  it('leaves the dollar total untouched by a missing estimate', () => {
    const withGap = summarizeProductionCosts([
      action({ quantity: 5, estimated_unit_cost_cents: 1850 }),
      action({ quantity: 999 }),
    ])
    const without = summarizeProductionCosts([
      action({ quantity: 5, estimated_unit_cost_cents: 1850 }),
    ])

    expect(withGap.knownTotalCents).toBe(without.knownTotalCents)
    expect(withGap.byType).toEqual(without.byType)
  })

  it('treats a stored cost this product would never write as missing', () => {
    for (const bad of [-100, 12.5, Number.NaN] as number[]) {
      const summary = summarizeProductionCosts([
        action({ quantity: 2, estimated_unit_cost_cents: bad }),
      ])
      expect(summary.knownTotalCents).toBe(0)
      expect(summary.missingCount).toBe(1)
    }
  })

  it('counts an action estimated at zero as estimated, not as missing', () => {
    // Somebody decided it costs nothing. That is an answer.
    const summary = summarizeProductionCosts([
      action({ quantity: 4, estimated_unit_cost_cents: 0 }),
    ])
    expect(summary.knownTotalCents).toBe(0)
    expect(summary.estimatedCount).toBe(1)
    expect(summary.missingCount).toBe(0)
    expect(isCostEstimateComplete(summary)).toBe(true)
  })
})

describe('a production with no action items', () => {
  it('costs nothing known and is missing nothing', () => {
    const summary = summarizeProductionCosts([])

    expect(summary.knownTotalCents).toBe(0)
    expect(summary.estimatedCount).toBe(0)
    expect(summary.missingCount).toBe(0)
    expect(isCostEstimateComplete(summary)).toBe(true)
    expect(missingCostNote(summary)).toBeNull()
    expect(costBreakdown(summary).every((row) => row.cents === 0)).toBe(true)
  })
})

describe('every combination of type and status', () => {
  it('counts each action exactly once, in the right bucket', () => {
    const types: ActionType[] = ['buy', 'rent', 'build', 'repair']
    const statuses: ActionStatus[] = ['todo', 'in_progress', 'done', 'cancelled']

    const actions = types.flatMap((action_type) => statuses.map(
      (status) => action({ action_type, status, quantity: 2, estimated_unit_cost_cents: 500 }),
    ))

    const summary = summarizeProductionCosts(actions)

    // Three counted statuses per type, 2 x $5.00 each.
    for (const type of types) {
      expect(formatCents(summary.byType[type]), type).toBe('$30.00')
    }
    expect(formatCents(summary.knownTotalCents)).toBe('$120.00')
    expect(summary.estimatedCount).toBe(12)
    expect(summary.missingCount).toBe(0)
  })
})

describe('what a suggested inventory price may be used for', () => {
  it('offers itself for buying, where the shelf price is the answer', () => {
    expect(actionTypeTakesPrefill('buy')).toBe(true)
  })

  it.each(['rent', 'build', 'repair'] as ActionType[])(
    'stays out of %s, which the shelf price cannot answer',
    (type) => {
      // A week's rental, the lumber for a build, and a shop's repair charge are
      // different questions. A confident wrong number in a budget is worse than
      // a blank somebody has to fill in.
      expect(actionTypeTakesPrefill(type)).toBe(false)
    },
  )
})

describe('a single action in a list', () => {
  it('shows its line total', () => {
    expect(actionEstimateLabel({ quantity: 5, estimated_unit_cost_cents: 1850 }))
      .toBe('$92.50')
  })

  it('says it is not estimated rather than showing a dash or a zero', () => {
    expect(actionEstimateLabel({ quantity: 5 })).toBe('Not estimated')
    // The same, arriving as an explicitly absent field rather than a missing key.
    expect(actionEstimateLabel(action({ quantity: 5 }))).toBe('Not estimated')
  })

  it('shows a deliberate zero as zero', () => {
    expect(actionEstimateLabel({ quantity: 5, estimated_unit_cost_cents: 0 })).toBe('$0.00')
  })
})
