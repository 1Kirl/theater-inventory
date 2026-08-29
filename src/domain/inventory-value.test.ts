import { describe, expect, it } from 'vitest'
import { activeQuantityOf, estimatedInventoryValue } from '@/domain/inventory-value'
import { formatCents } from '@/domain/money'
import type { InventoryItem, UnitCounts } from '@/types/inventory'

function bulk(overrides: Partial<InventoryItem> = {}): InventoryItem {
  return {
    item_id: 'item-1',
    organization_id: 'org-a',
    name: 'XLR Cable',
    tracking_mode: 'bulk',
    quantity_total: 12,
    quantity_available: 8,
    ...overrides,
  } as InventoryItem
}

function counts(overrides: Partial<UnitCounts> = {}): UnitCounts {
  return {
    active_total: 10, available: 6, unusable_on_hand: 1, in_use: 2,
    in_maintenance: 1, lost: 0, retired: 4,
    ...overrides,
  } as UnitCounts
}

function serialized(overrides: Partial<InventoryItem> = {}): InventoryItem {
  return {
    ...bulk(),
    tracking_mode: 'serialized',
    unit_counts: counts(),
    quantity_total: 10,
    ...overrides,
  } as InventoryItem
}

describe('how much stock an item has', () => {
  it('uses the recorded quantity for a bulk item', () => {
    expect(activeQuantityOf(bulk({ quantity_total: 12 }))).toBe(12)
  })

  it('uses the active unit count for a serialized item, not the retired ones', () => {
    // Four retired units are kept for their history. The program does not still
    // have them, so replacing what it has does not include them.
    expect(activeQuantityOf(serialized())).toBe(10)
  })

  it('reads the units rather than the parent mirror, which is the copy', () => {
    const drifted = serialized({
      unit_counts: counts({ active_total: 7 }),
      quantity_total: 999,
    })
    expect(activeQuantityOf(drifted)).toBe(7)
  })

  it('falls back to the recorded quantity for an item written before units existed', () => {
    const legacy = bulk({ quantity_total: 5 })
    delete (legacy as { tracking_mode?: unknown }).tracking_mode
    expect(activeQuantityOf(legacy)).toBe(5)
  })
})

describe('what the active stock would cost to replace', () => {
  it('multiplies the unit cost by what is actually there', () => {
    expect(formatCents(estimatedInventoryValue(bulk({
      quantity_total: 12, unit_cost_cents: 1850,
    })) ?? -1)).toBe('$222.00')
  })

  it('leaves retired serialized units out of the number', () => {
    // 10 active at $249.00, not 14 including the four retired.
    expect(formatCents(estimatedInventoryValue(serialized({
      unit_cost_cents: 24900,
    })) ?? -1)).toBe('$2,490.00')
  })

  it('is unknown when the item has never been priced', () => {
    // Not zero. An unpriced catalog would otherwise report a program's entire
    // inventory as worth nothing.
    expect(estimatedInventoryValue(bulk())).toBeNull()
    expect(estimatedInventoryValue(serialized())).toBeNull()
  })

  it('is zero only when somebody recorded zero', () => {
    expect(estimatedInventoryValue(bulk({ unit_cost_cents: 0 }))).toBe(0)
  })

  it('is zero when there is nothing left, even at a known price', () => {
    expect(estimatedInventoryValue(bulk({ quantity_total: 0, unit_cost_cents: 1850 }))).toBe(0)
    expect(estimatedInventoryValue(serialized({
      unit_counts: counts({ active_total: 0, retired: 14 }), unit_cost_cents: 1850,
    }))).toBe(0)
  })
})
