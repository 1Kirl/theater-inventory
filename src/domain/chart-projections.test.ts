import { describe, expect, it } from 'vitest'
import { categoryChart, costChart, lifecycleChart } from '@/domain/chart-projections'
import { summarizeProductionCosts } from '@/domain/production-costs'
import { activeQuantityOf } from '@/domain/inventory-value'
import type { InventoryItem, UnitCounts } from '@/types/inventory'
import type { ActionItem } from '@/types/production'

function counts(overrides: Partial<UnitCounts> = {}): UnitCounts {
  const base = {
    available: 6, unusable_on_hand: 1, in_use: 2, in_maintenance: 1, lost: 0, retired: 4,
    ...overrides,
  }
  return {
    ...base,
    // The stored invariant, so a fixture cannot accidentally assert against an
    // item shape the application would never write.
    active_total: base.available + base.unusable_on_hand + base.in_use
      + base.in_maintenance + base.lost,
  }
}

function bulk(overrides: Partial<InventoryItem> = {}): InventoryItem {
  return {
    item_id: 'item-1',
    organization_id: 'org-a',
    name: 'XLR Cable',
    category: 'Cables',
    tracking_mode: 'bulk',
    quantity_total: 12,
    quantity_available: 8,
    ...overrides,
  } as InventoryItem
}

function serialized(overrides: Partial<InventoryItem> = {}): InventoryItem {
  const unitCounts = (overrides.unit_counts ?? counts()) as UnitCounts
  return {
    ...bulk(),
    item_id: 'item-2',
    name: 'Source Four',
    category: 'Lighting Instruments',
    tracking_mode: 'serialized',
    ...overrides,
    unit_counts: unitCounts,
    quantity_total: unitCounts.active_total,
    quantity_available: unitCounts.available,
  } as InventoryItem
}

function action(overrides: Partial<ActionItem> = {}): ActionItem {
  return {
    action_item_id: 'act-1',
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

const valueOf = (slices: readonly { key: string; value: number }[], key: string) =>
  slices.find((slice) => slice.key === key)?.value

/* ================================================================== */

describe('equipment lifecycle chart', () => {
  it('1. counts each lifecycle bucket from the item’s own unit counts', () => {
    const chart = lifecycleChart([serialized()])

    expect(valueOf(chart.slices, 'available')).toBe(6)
    expect(valueOf(chart.slices, 'unusable_on_hand')).toBe(1)
    expect(valueOf(chart.slices, 'in_use')).toBe(2)
    expect(valueOf(chart.slices, 'in_maintenance')).toBe(1)
    expect(valueOf(chart.slices, 'lost')).toBe(0)
    expect(valueOf(chart.slices, 'retired')).toBe(4)
  })

  it('2. carries the unusable-on-hand bucket, so the active slices add up', () => {
    // The whole reason this slice exists. Without it the ring would be short by
    // one unit and a reader would have no way to know which slice was wrong.
    const chart = lifecycleChart([serialized()])
    const active = chart.slices
      .filter((slice) => slice.key !== 'retired')
      .reduce((sum, slice) => sum + slice.value, 0)

    expect(active).toBe(chart.activeTotal)
  })

  it('3. does not count an unusable unit on the shelf as available', () => {
    const chart = lifecycleChart([
      serialized({ unit_counts: counts({ available: 0, unusable_on_hand: 5, in_use: 0, in_maintenance: 0, lost: 0, retired: 0 }) }),
    ])

    expect(valueOf(chart.slices, 'available')).toBe(0)
    expect(valueOf(chart.slices, 'unusable_on_hand')).toBe(5)
    expect(chart.activeTotal).toBe(5)
  })

  it('4. keeps retired out of the active total but inside the chart total', () => {
    const chart = lifecycleChart([serialized()])
    expect(chart.activeTotal).toBe(10)
    expect(chart.total).toBe(14)
  })

  it('5. agrees with the item’s stored active_total', () => {
    const item = serialized()
    expect(lifecycleChart([item]).activeTotal).toBe(item.unit_counts?.active_total)
  })

  it('6. sums across several serialized items', () => {
    const chart = lifecycleChart([
      serialized({ item_id: 'a' }),
      serialized({ item_id: 'b' }),
    ])
    expect(valueOf(chart.slices, 'available')).toBe(12)
    expect(chart.serializedItemCount).toBe(2)
  })

  it('7. counts a bulk item once, never by its quantity', () => {
    // QA-13. The rule the whole aggregation rests on: five hundred cables are
    // one thing with one status. Adding the quantity would bury the
    // individually tracked equipment under numbers that were never units.
    const chart = lifecycleChart([bulk({ quantity_total: 500 })])

    expect(chart.bulkItemCount).toBe(1)
    expect(chart.serializedItemCount).toBe(0)
    expect(chart.total).toBe(1)
    expect(valueOf(chart.slices, 'available')).toBe(1)
  })

  it('7a. reads a bulk item with no stored status as available', () => {
    // Every bulk item written before item lifecycle existed is in exactly this
    // position, and nothing is migrated to make it true.
    const { status: _dropped, ...legacy } = { ...bulk(), status: undefined }
    const chart = lifecycleChart([legacy as InventoryItem])

    expect(valueOf(chart.slices, 'available')).toBe(1)
    expect(chart.bulkItemCount).toBe(1)
  })

  it('7b. places a bulk item under its own status', () => {
    const chart = lifecycleChart([
      bulk({ item_id: 'a', status: 'in_use' }),
      bulk({ item_id: 'b', status: 'in_use' }),
      bulk({ item_id: 'c', status: 'lost' }),
      bulk({ item_id: 'd', status: 'retired' }),
    ])

    expect(valueOf(chart.slices, 'in_use')).toBe(2)
    expect(valueOf(chart.slices, 'lost')).toBe(1)
    expect(valueOf(chart.slices, 'retired')).toBe(1)
    // Retired is history, not active equipment — the same rule units follow.
    expect(chart.activeTotal).toBe(3)
    expect(chart.total).toBe(4)
  })

  it('7c. adds individual units and bulk items together', () => {
    // The worked example from QA-13: units contribute per unit, bulk items
    // contribute one apiece.
    const chart = lifecycleChart([
      serialized({ item_id: 's', unit_counts: counts({ active_total: 14, available: 10, in_use: 4 }) }),
      bulk({ item_id: 'b1', status: 'available' }),
      bulk({ item_id: 'b2', status: 'available' }),
      bulk({ item_id: 'b3', status: 'available' }),
      bulk({ item_id: 'b4', status: 'in_use' }),
      bulk({ item_id: 'b5', status: 'in_use' }),
    ])

    expect(valueOf(chart.slices, 'available')).toBe(13)
    expect(valueOf(chart.slices, 'in_use')).toBe(6)
    expect(chart.serializedItemCount).toBe(1)
    expect(chart.bulkItemCount).toBe(5)
  })

  it('8. ignores an item marked serialized that has no unit counts', () => {
    // The key is absent, not set to undefined: `exactOptionalPropertyTypes`
    // treats those as different, and Firestore only ever produces the former.
    const chart = lifecycleChart([{ ...bulk(), tracking_mode: 'serialized' }])
    expect(chart.serializedItemCount).toBe(0)
  })

  it('8a. ignores unit counts left on a bulk item, and counts the item once', () => {
    // `trackingModeOf` reads an absent mode as bulk, so counts left on an item
    // that is not serialized are stale data, not equipment. They must not reach
    // the ring — the item contributes itself, and nothing else.
    const { tracking_mode: _omitted, ...withoutMode } = bulk()
    const chart = lifecycleChart([
      { ...bulk(), tracking_mode: 'bulk', unit_counts: counts() },
      // An item written before serialized tracking existed: no mode at all.
      { ...withoutMode, item_id: 'legacy', unit_counts: counts() } as InventoryItem,
    ])

    expect(chart.serializedItemCount).toBe(0)
    expect(chart.bulkItemCount).toBe(2)
    // Two items, not the eighteen their stale counts would have contributed.
    expect(chart.total).toBe(2)
    expect(valueOf(chart.slices, 'available')).toBe(2)
  })

  it('9. reports no items rather than an empty chart when there is nothing', () => {
    const chart = lifecycleChart([])
    expect(chart.serializedItemCount).toBe(0)
    expect(chart.total).toBe(0)
  })

  it('10. keeps zero-count buckets as slices, so a zero is visibly zero', () => {
    const chart = lifecycleChart([serialized()])
    expect(chart.slices).toHaveLength(6)
    expect(valueOf(chart.slices, 'lost')).toBe(0)
  })

  it('11. every slice carries a label and a theme-driven colour', () => {
    for (const slice of lifecycleChart([serialized()]).slices) {
      expect(slice.label.length).toBeGreaterThan(0)
      expect(slice.color).toMatch(/^var\(--/)
    }
  })

  it('12. gives every slice its own colour', () => {
    const colors = lifecycleChart([serialized()]).slices.map((slice) => slice.color)
    expect(new Set(colors).size).toBe(colors.length)
  })
})

/* ================================================================== */

describe('inventory by category', () => {
  it('13. aggregates quantity by category', () => {
    const chart = categoryChart([
      bulk({ item_id: 'a', category: 'Cables', quantity_total: 12 }),
      bulk({ item_id: 'b', category: 'Cables', quantity_total: 8 }),
      bulk({ item_id: 'c', category: 'Props', quantity_total: 3 }),
    ])

    expect(valueOf(chart.rows, 'Cables')).toBe(20)
    expect(valueOf(chart.rows, 'Props')).toBe(3)
    expect(chart.total).toBe(23)
  })

  it('14. measures a serialized item by its active units, not its retired ones', () => {
    const item = serialized({ category: 'Lighting Instruments' })
    const chart = categoryChart([item])

    expect(valueOf(chart.rows, 'Lighting Instruments')).toBe(10)
    expect(valueOf(chart.rows, 'Lighting Instruments')).toBe(activeQuantityOf(item))
  })

  it('15. uses the same measure for both tracking modes', () => {
    // The honesty claim the chart caption makes: a bulk bar and a serialized bar
    // are the same unit, so putting them side by side compares like with like.
    const chart = categoryChart([
      bulk({ item_id: 'a', category: 'Cables', quantity_total: 10 }),
      serialized({ item_id: 'b', category: 'Lighting Instruments' }),
    ])

    expect(valueOf(chart.rows, 'Cables')).toBe(10)
    expect(valueOf(chart.rows, 'Lighting Instruments')).toBe(10)
  })

  it('16. orders largest first', () => {
    const chart = categoryChart([
      bulk({ item_id: 'a', category: 'Props', quantity_total: 3 }),
      bulk({ item_id: 'b', category: 'Cables', quantity_total: 30 }),
      bulk({ item_id: 'c', category: 'Tools', quantity_total: 10 }),
    ])
    expect(chart.rows.map((row) => row.key)).toEqual(['Cables', 'Tools', 'Props'])
  })

  it('17. breaks ties by name, so the order does not shuffle between renders', () => {
    const chart = categoryChart([
      bulk({ item_id: 'a', category: 'Tools', quantity_total: 5 }),
      bulk({ item_id: 'b', category: 'Cables', quantity_total: 5 }),
    ])
    expect(chart.rows.map((row) => row.key)).toEqual(['Cables', 'Tools'])
  })

  it('18. reports the item count separately from the quantity', () => {
    const chart = categoryChart([
      bulk({ item_id: 'a', category: 'Cables', quantity_total: 40 }),
      bulk({ item_id: 'b', category: 'Cables', quantity_total: 2 }),
    ])
    expect(valueOf(chart.rows, 'Cables')).toBe(42)
    expect(chart.rows[0]?.hint).toBe('2 items')
    expect(chart.itemCount).toBe(2)
  })

  it('19. keeps a category with zero quantity as a row', () => {
    const chart = categoryChart([bulk({ category: 'Props', quantity_total: 0 })])
    expect(chart.rows).toHaveLength(1)
    expect(valueOf(chart.rows, 'Props')).toBe(0)
  })

  it('20. names an item with no category rather than dropping it', () => {
    const chart = categoryChart([bulk({ category: '   ', quantity_total: 4 })])
    expect(valueOf(chart.rows, 'Uncategorized')).toBe(4)
  })

  it('21. is empty when the inventory is', () => {
    const chart = categoryChart([])
    expect(chart.rows).toEqual([])
    expect(chart.total).toBe(0)
    expect(chart.itemCount).toBe(0)
  })
})

/* ================================================================== */

describe('production cost breakdown', () => {
  it('22. splits the known total by kind of work', () => {
    const chart = costChart([
      action({ action_type: 'buy', quantity: 5, estimated_unit_cost_cents: 1000 }),
      action({ action_type: 'rent', quantity: 2, estimated_unit_cost_cents: 2500 }),
    ])

    expect(valueOf(chart.rows, 'buy')).toBe(5000)
    expect(valueOf(chart.rows, 'rent')).toBe(5000)
    expect(chart.knownTotalCents).toBe(10_000)
  })

  it('23. always offers all four kinds, so an unused one reads as zero', () => {
    const chart = costChart([action({ action_type: 'buy', quantity: 1, estimated_unit_cost_cents: 100 })])
    expect(chart.rows.map((row) => row.key)).toEqual(['buy', 'rent', 'build', 'repair'])
  })

  it('24. the parts add up to the whole', () => {
    const chart = costChart([
      action({ action_type: 'buy', quantity: 3, estimated_unit_cost_cents: 700 }),
      action({ action_type: 'build', quantity: 1, estimated_unit_cost_cents: 4500 }),
      action({ action_type: 'repair', quantity: 2, estimated_unit_cost_cents: 900 }),
    ])
    const summed = chart.rows.reduce((total, row) => total + row.value, 0)
    expect(summed).toBe(chart.knownTotalCents)
  })

  it('25. excludes cancelled work, matching the existing cost semantics', () => {
    const chart = costChart([
      action({ action_type: 'buy', quantity: 1, estimated_unit_cost_cents: 5000, status: 'cancelled' }),
      action({ action_type: 'buy', quantity: 1, estimated_unit_cost_cents: 1000, status: 'todo' }),
    ])
    expect(chart.knownTotalCents).toBe(1000)
    expect(chart.unknownCount).toBe(0)
  })

  it('26. includes completed work, which was still paid for', () => {
    const chart = costChart([
      action({ action_type: 'buy', quantity: 1, estimated_unit_cost_cents: 2000, status: 'done' }),
    ])
    expect(chart.knownTotalCents).toBe(2000)
  })

  it('27. counts an unestimated action as unknown, never as zero', () => {
    const chart = costChart([
      action({ action_type: 'buy', quantity: 2, estimated_unit_cost_cents: 1500 }),
      action({ action_type: 'rent', quantity: 4 }),
      action({ action_type: 'rent', quantity: 1 }),
    ])

    expect(chart.knownTotalCents).toBe(3000)
    expect(chart.unknownCount).toBe(2)
    // The unknown rentals contributed nothing to the rent bar.
    expect(valueOf(chart.rows, 'rent')).toBe(0)
  })

  it('28. keeps an explicit zero estimate apart from an unknown one', () => {
    const zero = costChart([action({ action_type: 'build', quantity: 3, estimated_unit_cost_cents: 0 })])
    const unknown = costChart([action({ action_type: 'build', quantity: 3 })])

    expect(zero.unknownCount).toBe(0)
    expect(zero.estimatedCount).toBe(1)
    expect(unknown.unknownCount).toBe(1)
    expect(unknown.estimatedCount).toBe(0)
    // Both draw nothing, which is why the counts above are what tell them apart.
    expect(zero.knownTotalCents).toBe(0)
    expect(unknown.knownTotalCents).toBe(0)
  })

  it('29. knows nothing, and draws nothing, when nothing is estimated', () => {
    const chart = costChart([action({ action_type: 'buy', quantity: 2 })])
    expect(chart.hasKnownEstimate).toBe(false)
    expect(chart.hasDrawableCost).toBe(false)
    expect(chart.unknownCount).toBe(1)
  })

  it('30. draws nothing for an all-zero estimate but still knows it exists', () => {
    // The two questions the first version of this collapsed into one. Four
    // empty bars would claim the work was costed and came to nothing in four
    // separate categories — so nothing is drawn. But somebody did enter that
    // estimate, and calling it missing is a different and false statement.
    const chart = costChart([action({ action_type: 'buy', quantity: 2, estimated_unit_cost_cents: 0 })])

    expect(chart.hasDrawableCost).toBe(false)
    expect(chart.hasKnownEstimate).toBe(true)
    expect(chart.knownTotalCents).toBe(0)
    expect(chart.estimatedCount).toBe(1)
    expect(chart.unknownCount).toBe(0)
  })

  it('30a. a positive estimate is both known and drawable', () => {
    const chart = costChart([action({ action_type: 'buy', quantity: 1, estimated_unit_cost_cents: 10_000 })])
    expect(chart.hasKnownEstimate).toBe(true)
    expect(chart.hasDrawableCost).toBe(true)
    expect(chart.knownTotalCents).toBe(10_000)
  })

  it('30b. a known zero is never reported as an unknown', () => {
    // The line the product contract draws: unknown cost != $0.00.
    const zero = costChart([action({ quantity: 3, estimated_unit_cost_cents: 0 })])
    const unknown = costChart([action({ quantity: 3 })])

    expect(zero.hasKnownEstimate).toBe(true)
    expect(zero.unknownCount).toBe(0)
    expect(unknown.hasKnownEstimate).toBe(false)
    expect(unknown.unknownCount).toBe(1)
    // Both draw nothing; only the counts tell the two states apart.
    expect(zero.hasDrawableCost).toBe(unknown.hasDrawableCost)
  })

  it('30c. a known zero alongside an unknown reports both truthfully', () => {
    const chart = costChart([
      action({ action_type: 'build', quantity: 4, estimated_unit_cost_cents: 0 }),
      action({ action_type: 'rent', quantity: 2 }),
    ])

    expect(chart.hasKnownEstimate).toBe(true)
    expect(chart.hasDrawableCost).toBe(false)
    expect(chart.estimatedCount).toBe(1)
    expect(chart.unknownCount).toBe(1)
    expect(chart.knownTotalCents).toBe(0)
  })

  it('30d. a positive estimate beside a zero one still draws', () => {
    const chart = costChart([
      action({ action_type: 'buy', quantity: 1, estimated_unit_cost_cents: 2500 }),
      action({ action_type: 'build', quantity: 9, estimated_unit_cost_cents: 0 }),
    ])

    expect(chart.hasDrawableCost).toBe(true)
    expect(chart.estimatedCount).toBe(2)
    expect(valueOf(chart.rows, 'build')).toBe(0)
    expect(valueOf(chart.rows, 'buy')).toBe(2500)
  })

  it('30e. a cancelled zero-cost action establishes no known estimate', () => {
    // Cancelled work is excluded before its cost is read, so it can neither add
    // to the total nor make the production look as though it has been costed.
    const chart = costChart([
      action({ action_type: 'buy', quantity: 5, estimated_unit_cost_cents: 0, status: 'cancelled' }),
    ])

    expect(chart.hasKnownEstimate).toBe(false)
    expect(chart.estimatedCount).toBe(0)
    expect(chart.unknownCount).toBe(0)
  })

  it('30f. a cancelled zero beside a live unknown leaves the unknown alone', () => {
    const chart = costChart([
      action({ action_type: 'buy', quantity: 5, estimated_unit_cost_cents: 0, status: 'cancelled' }),
      action({ action_type: 'rent', quantity: 1 }),
    ])

    expect(chart.hasKnownEstimate).toBe(false)
    expect(chart.unknownCount).toBe(1)
  })

  it('31. handles a production with no actions at all', () => {
    const chart = costChart([])
    expect(chart.hasKnownEstimate).toBe(false)
    expect(chart.hasDrawableCost).toBe(false)
    expect(chart.knownTotalCents).toBe(0)
    expect(chart.unknownCount).toBe(0)
    expect(chart.estimatedCount).toBe(0)
  })

  it('32. never disagrees with the panel it sits inside', () => {
    const actions = [
      action({ action_type: 'buy', quantity: 5, estimated_unit_cost_cents: 1850, status: 'done' }),
      action({ action_type: 'rent', quantity: 3, estimated_unit_cost_cents: 4000 }),
      action({ action_type: 'build', quantity: 2 }),
      action({ action_type: 'repair', quantity: 1, estimated_unit_cost_cents: 9900, status: 'cancelled' }),
    ]
    const summary = summarizeProductionCosts(actions)
    const chart = costChart(actions)

    expect(chart.knownTotalCents).toBe(summary.knownTotalCents)
    expect(chart.unknownCount).toBe(summary.missingCount)
    expect(chart.estimatedCount).toBe(summary.estimatedCount)
    for (const row of chart.rows) {
      expect(row.value).toBe(summary.byType[row.key as keyof typeof summary.byType])
    }
  })
})
