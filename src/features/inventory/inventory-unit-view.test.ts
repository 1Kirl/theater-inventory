import { describe, expect, it } from 'vitest'
import {
  UNITS_PAGE_SIZE, UNIT_STATUS_LABELS, itemPresentation, paginateUnits, unitBreakdownLine,
  unitStatusTone,
} from '@/features/inventory/inventory-unit-view'
import { EMPTY_UNIT_COUNTS } from '@/domain/inventory'
import { STATUS_TONES } from '@/domain/status-tone'
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

  // The tone vocabulary itself is asserted in src/domain/status-tone.test.ts.
  // What matters here is that this module still resolves one.
  it('resolves a tone for every status', () => {
    for (const status of UNIT_STATUSES) {
      expect(STATUS_TONES).toContain(unitStatusTone(status))
    }
  })
})

describe('paginateUnits', () => {
  const listOf = (n: number) => Array.from({ length: n }, (_, i) => `MIC-${i + 1}`)

  it('leaves a short list alone, so no control is drawn for it', () => {
    // The QA boundary: fifteen fits, sixteen does not.
    const page = paginateUnits(listOf(15), 1)

    expect(page.paginated).toBe(false)
    expect(page.pageCount).toBe(1)
    expect(page.items).toHaveLength(15)
  })

  it('splits at sixteen, into two pages', () => {
    const page = paginateUnits(listOf(16), 1)

    expect(page.paginated).toBe(true)
    expect(page.pageCount).toBe(2)
    expect(page.items).toHaveLength(15)
  })

  it('counts pages the way the QA examples do', () => {
    expect(paginateUnits(listOf(30), 1).pageCount).toBe(2)
    expect(paginateUnits(listOf(31), 1).pageCount).toBe(3)
    expect(paginateUnits(listOf(45), 1).pageCount).toBe(3)
  })

  it('never puts more than a page-size on a page', () => {
    for (const total of [1, 15, 16, 31, 100]) {
      for (let page = 1; page <= paginateUnits(listOf(total), 1).pageCount; page += 1) {
        expect(paginateUnits(listOf(total), page).items.length)
          .toBeLessThanOrEqual(UNITS_PAGE_SIZE)
      }
    }
  })

  it('keeps the order it was given and loses nothing across the pages', () => {
    // Ordering belongs to the caller; this must not sort, dedupe, or drop.
    const all = listOf(31)
    const rejoined = [1, 2, 3].flatMap((page) => paginateUnits(all, page).items)

    expect(rejoined).toEqual(all)
  })

  it('corrects a page number the list has outgrown', () => {
    // Deleting the last unit on the last page: the stored page still says 3,
    // and without this the card would render empty with no way back.
    const page = paginateUnits(listOf(16), 3)

    expect(page.page).toBe(2)
    expect(page.items).toHaveLength(1)
  })

  it('corrects a page number below the first one', () => {
    expect(paginateUnits(listOf(20), 0).page).toBe(1)
    expect(paginateUnits(listOf(20), -4).page).toBe(1)
  })

  it('survives a page number that is not a number at all', () => {
    expect(paginateUnits(listOf(20), Number.NaN).page).toBe(1)
    expect(paginateUnits(listOf(20), 1.7).page).toBe(1)
  })

  it('reports an empty list as one empty page rather than none', () => {
    const page = paginateUnits([], 1)

    expect(page.pageCount).toBe(1)
    expect(page.paginated).toBe(false)
    expect(page.items).toEqual([])
    // Not "1–0 of 0".
    expect(page.from).toBe(0)
    expect(page.to).toBe(0)
  })

  it('numbers the positions it is showing', () => {
    const second = paginateUnits(listOf(42), 2)

    expect(second.from).toBe(16)
    expect(second.to).toBe(30)
    expect(second.total).toBe(42)

    const last = paginateUnits(listOf(42), 3)
    expect(last.from).toBe(31)
    expect(last.to).toBe(42)
  })

  it('refuses a page size that would divide by zero', () => {
    expect(paginateUnits(listOf(5), 1, 0).items).toHaveLength(1)
    expect(paginateUnits(listOf(5), 1, -3).items).toHaveLength(1)
  })
})
