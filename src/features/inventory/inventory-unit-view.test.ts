import { describe, expect, it } from 'vitest'
import {
  UNIT_STATUS_LABELS, itemPresentation, unitBreakdownLine, unitStatusTone,
} from '@/features/inventory/inventory-unit-view'
import { EMPTY_UNIT_COUNTS } from '@/domain/inventory'
import { UNIT_STATUSES, type InventoryItem, type UnitCounts } from '@/types/inventory'

function item(overrides: Partial<InventoryItem> = {}): InventoryItem {
  return {
    tracking_mode: 'bulk',
    location: 'Shelf A',
    team_id: 'team-lighting',
    ...overrides,
  } as InventoryItem
}

function unitCounts(overrides: Partial<UnitCounts> = {}): UnitCounts {
  return { ...EMPTY_UNIT_COUNTS, ...overrides }
}

describe('itemPresentation', () => {
  it('presents a bulk item exactly as before', () => {
    expect(itemPresentation(item())).toEqual({
      isGrouping: false,
      showsParentLocation: true,
      showsParentTeam: true,
      showsParentInspection: true,
      showsParentUpdatedAt: true,
      showsLifecycleSummary: false,
      badge: null,
    })
  })

  it('treats an item with no tracking mode as bulk', () => {
    // Every item written before serialization existed. Their presentation must
    // not change.
    expect(itemPresentation({} as InventoryItem)).toMatchObject({
      isGrouping: false,
      showsParentLocation: true,
      showsParentTeam: true,
      showsParentInspection: true,
      showsParentUpdatedAt: true,
    })
  })

  it('does not present a serialized item\'s parent location as a unit location', () => {
    expect(itemPresentation(item({ tracking_mode: 'serialized' })).showsParentLocation).toBe(false)
  })

  it('does not present a serialized item\'s parent team as unit ownership', () => {
    expect(itemPresentation(item({ tracking_mode: 'serialized' })).showsParentTeam).toBe(false)
  })

  it('does not present a serialized item\'s parent inspection date', () => {
    expect(itemPresentation(item({ tracking_mode: 'serialized' })).showsParentInspection).toBe(false)
  })

  it('does not present a serialized item\'s last-updated stamp as equipment news', () => {
    // It moves whenever any unit does, so a clamp untouched since spring reads
    // as updated this morning because someone else's came back from repair.
    expect(itemPresentation(item({ tracking_mode: 'serialized' })).showsParentUpdatedAt)
      .toBe(false)
  })

  it('hides every parent equipment fact for a grouping, and only those', () => {
    const shown = itemPresentation(item({ tracking_mode: 'serialized' }))

    expect([
      shown.showsParentLocation,
      shown.showsParentTeam,
      shown.showsParentInspection,
      shown.showsParentUpdatedAt,
    ]).toEqual([false, false, false, false])
    // What replaces them.
    expect(shown.showsLifecycleSummary).toBe(true)
    expect(shown.badge).toBe('Individual Equipment')
  })

  it('labels a serialized item as individual equipment', () => {
    expect(itemPresentation(item({ tracking_mode: 'serialized' })).badge)
      .toBe('Individual Equipment')
  })

  it('shows the lifecycle summary only for a grouping', () => {
    expect(itemPresentation(item({ tracking_mode: 'serialized' })).showsLifecycleSummary).toBe(true)
    expect(itemPresentation(item()).showsLifecycleSummary).toBe(false)
  })
})

describe('unitBreakdownLine', () => {
  it('says so when there are no units yet', () => {
    expect(unitBreakdownLine({})).toBe('No units yet')
  })

  it('shows available on its own when nothing else applies', () => {
    expect(unitBreakdownLine({ unit_counts: unitCounts({ available: 5, active_total: 5 }) }))
      .toBe('5 available')
  })

  it('names every lifecycle bucket that holds something', () => {
    const line = unitBreakdownLine({
      unit_counts: unitCounts({
        available: 4, in_use: 2, in_maintenance: 1, lost: 1, unusable_on_hand: 3, active_total: 11,
      }),
    })

    expect(line).toBe('4 available · 2 in use · 1 in maintenance · 1 lost · 3 unusable')
  })

  it('leaves out the buckets that are empty', () => {
    const line = unitBreakdownLine({
      unit_counts: unitCounts({ available: 4, lost: 1, active_total: 5 }),
    })

    expect(line).toBe('4 available · 1 lost')
    expect(line).not.toContain('in use')
  })

  it('reports zero available rather than hiding it', () => {
    // A serialized item with nothing on the shelf is exactly what someone needs
    // to see, so this line is never blank.
    expect(unitBreakdownLine({ unit_counts: unitCounts({ in_use: 3, active_total: 3 }) }))
      .toBe('0 available · 3 in use')
  })
})

describe('unit status presentation', () => {
  it('labels every lifecycle status', () => {
    for (const status of UNIT_STATUSES) {
      expect(UNIT_STATUS_LABELS[status].length).toBeGreaterThan(0)
    }
  })

  it('marks lost as the most alarming and retired as spent', () => {
    expect(unitStatusTone('lost')).toBe('destructive')
    expect(unitStatusTone('in_maintenance')).toBe('warning')
    expect(unitStatusTone('retired')).toBe('muted')
    expect(unitStatusTone('available')).toBe('neutral')
  })
})
