import { describe, expect, it } from 'vitest'
import { summarizeInventory, summarizeMaintenance } from '@/features/dashboard/dashboard-summary'
import { EMPTY_CONDITION_COUNTS } from '@/domain/inventory'
import type { InventoryItem, UnitCounts } from '@/types/inventory'
import type { MaintenanceRecord } from '@/types/maintenance'

/**
 * The dashboard against the domain as Phases 11A–11G left it.
 *
 * These are the claims the cards make out loud — active counts exclude retired
 * equipment, a planned repair is not a repair, and nothing is counted twice —
 * pinned so that a later change to the mirrors or the summary cannot quietly
 * make a card say something untrue.
 */

const NOW = new Date(2026, 7, 25, 10, 0, 0)

function counts(overrides: Partial<UnitCounts> = {}): UnitCounts {
  return {
    active_total: 0, available: 0, unusable_on_hand: 0, in_use: 0,
    in_maintenance: 0, lost: 0, retired: 0,
    ...overrides,
  } as UnitCounts
}

function bulk(overrides: Partial<InventoryItem> = {}): InventoryItem {
  return {
    item_id: 'item-bulk',
    organization_id: 'org-a',
    name: 'XLR Cable',
    category: 'Cables',
    team_id: 'team-sound',
    tracking_mode: 'bulk',
    quantity_total: 12,
    quantity_available: 8,
    condition_counts: { ...EMPTY_CONDITION_COUNTS, good: 12 },
    location: 'Booth',
    ...overrides,
  } as InventoryItem
}

/**
 * A serialized item, with its parent numbers mirrored from its units exactly as
 * the domain maintains them: `quantity_total` is the active total, so retired
 * equipment is already out of it.
 */
function serialized(unitCounts: UnitCounts, overrides: Partial<InventoryItem> = {}): InventoryItem {
  return {
    ...bulk(),
    item_id: 'item-mic',
    name: 'Wireless Handheld',
    category: 'Microphones',
    tracking_mode: 'serialized',
    unit_counts: unitCounts,
    quantity_total: unitCounts.active_total,
    quantity_available: unitCounts.available,
    condition_counts: { ...EMPTY_CONDITION_COUNTS, good: unitCounts.active_total },
    ...overrides,
  } as InventoryItem
}

function record(overrides: Partial<MaintenanceRecord> = {}): MaintenanceRecord {
  return {
    maintenance_id: 'rec-1',
    organization_id: 'org-a',
    inventory_item_id: 'item-bulk',
    team_id: 'team-sound',
    quantity_sent: 2,
    issue_description: 'crackling',
    status: 'in_service',
    ...overrides,
  } as MaintenanceRecord
}

describe('an organization that tracks everything as quantities', () => {
  it('counts what it has recorded', () => {
    const summary = summarizeInventory([bulk(), bulk({ item_id: 'i2', quantity_total: 5, quantity_available: 5 })])

    expect(summary.itemCount).toBe(2)
    expect(summary.totalUnits).toBe(17)
    expect(summary.availableUnits).toBe(13)
  })

  it('reports no lost equipment, because a quantity cannot go missing by name', () => {
    expect(summarizeInventory([bulk()]).lostUnits).toBe(0)
  })
})

describe('an organization that tracks individual equipment', () => {
  const item = serialized(counts({
    active_total: 8, available: 4, in_use: 2, in_maintenance: 1, lost: 1, retired: 3,
  }))

  it('counts the equipment it still has, not the equipment it ever had', () => {
    // Three retired microphones are kept for their history. Counting them would
    // tell a student technician there are eleven when there are eight.
    const summary = summarizeInventory([item])

    expect(summary.totalUnits).toBe(8)
    expect(summary.availableUnits).toBe(4)
  })

  it('surfaces missing equipment, which is the part that needs somebody to act', () => {
    expect(summarizeInventory([item]).lostUnits).toBe(1)
  })

  it('counts each piece once, never the parent and its units both', () => {
    // The dashboard reads items only. If it ever also read units, this is the
    // assertion that would fail.
    const summary = summarizeInventory([item])
    expect(summary.totalUnits).toBe(item.unit_counts?.active_total)
    expect(summary.itemCount).toBe(1)
  })

  it('is not confused by an item whose equipment is all retired', () => {
    const goneEntirely = serialized(counts({ active_total: 0, retired: 6 }))
    const summary = summarizeInventory([goneEntirely])

    expect(summary.totalUnits).toBe(0)
    expect(summary.availableUnits).toBe(0)
    // The catalog entry still exists, which is why it is still one record.
    expect(summary.itemCount).toBe(1)
  })
})

describe('an organization with some of each', () => {
  const items = [
    bulk(),
    serialized(counts({ active_total: 8, available: 4, in_use: 2, in_maintenance: 1, lost: 1, retired: 3 })),
  ]

  it('adds quantities and individual equipment into one honest total', () => {
    const summary = summarizeInventory(items)

    expect(summary.itemCount).toBe(2)
    expect(summary.totalUnits).toBe(20)
    expect(summary.availableUnits).toBe(12)
    expect(summary.lostUnits).toBe(1)
  })
})

describe('what the maintenance cards count', () => {
  it('counts equipment away for repair from the equipment itself', () => {
    const items = [serialized(counts({ active_total: 5, available: 3, in_maintenance: 2 }))]
    const summary = summarizeMaintenance([], NOW, 5, items)

    expect(summary.inServiceQuantity).toBe(2)
  })

  it('does not count a serialized repair record and its units both', () => {
    // The record says two went; the units say two are away. Counting both would
    // report four microphones in a shop that has two.
    const items = [serialized(counts({ active_total: 5, available: 3, in_maintenance: 2 }))]
    const serializedRecord = record({
      inventory_item_id: 'item-mic', tracking_mode: 'serialized', unit_ids: ['u1', 'u2'],
    } as Partial<MaintenanceRecord>)

    expect(summarizeMaintenance([serializedRecord], NOW, 5, items).inServiceQuantity).toBe(2)
  })

  it('still counts a bulk repair from its record, which is all that knows', () => {
    expect(summarizeMaintenance([record({ quantity_sent: 3 })], NOW, 5, []).inServiceQuantity)
      .toBe(3)
  })

  it('does not let a planned repair inflate what is physically away', () => {
    // A plan is an intention. The equipment is still on the shelf, and its
    // units are still counted as available — so nothing about a plan may move
    // the in-service number.
    const planned = record({ status: 'planned', quantity_sent: 4 })
    const items = [serialized(counts({ active_total: 5, available: 5 }))]

    const summary = summarizeMaintenance([planned], NOW, 5, items)

    expect(summary.inServiceQuantity).toBe(0)
    // It is still an open job somebody has to do, which is the other card.
    expect(summary.openCount).toBe(1)
  })

  it('keeps the two maintenance numbers describing different things', () => {
    // "Active Repairs" counts jobs, including one only planned. "Currently in
    // service" counts equipment that has physically gone. They are allowed to
    // disagree, and the cards say which is which.
    const planned = record({ maintenance_id: 'r1', status: 'planned', quantity_sent: 4 })
    const away = record({ maintenance_id: 'r2', status: 'in_service', quantity_sent: 1 })

    const summary = summarizeMaintenance([planned, away], NOW, 5, [])

    expect(summary.openCount).toBe(2)
    expect(summary.inServiceQuantity).toBe(1)
  })
})

describe('zero, unknown, and hidden are not the same thing', () => {
  it('an organization with no inventory reports zero, which is a fact', () => {
    const summary = summarizeInventory([])

    expect(summary.itemCount).toBe(0)
    expect(summary.totalUnits).toBe(0)
    expect(summary.lostUnits).toBe(0)
  })

  it('a serialized item with no units yet is not the same as a missing one', () => {
    // Converted but not yet described: zero equipment, one catalog record.
    const summary = summarizeInventory([serialized(counts())])

    expect(summary.itemCount).toBe(1)
    expect(summary.totalUnits).toBe(0)
  })
})
