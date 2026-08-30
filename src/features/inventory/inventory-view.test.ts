import { describe, expect, it } from 'vitest'
import { conditionTone } from '@/domain/status-tone'
import { EMPTY_CONDITION_COUNTS } from '@/domain/inventory'
import {
  EMPTY_FILTERS,
  conditionSummaryLabel,
  itemConditionTone,
  filterInventoryItems,
  teamNameOf,
  unclassifiedOf,
} from '@/features/inventory/inventory-view'
import type { ConditionCounts, InventoryItem } from '@/types/inventory'
import type { TheaterTeam } from '@/types/organization'

const teams = [
  { team_id: 't-lighting', name: 'Lighting' },
  { team_id: 't-costume', name: 'Costume' },
] as TheaterTeam[]

function item(overrides: Partial<InventoryItem> = {}): InventoryItem {
  return {
    item_id: 'i-1',
    organization_id: 'org-1',
    name: 'Source Four',
    category: 'Lighting Instruments',
    team_id: 't-lighting',
    quantity_total: 12,
    quantity_available: 8,
    condition_counts: { ...EMPTY_CONDITION_COUNTS, good: 12 } as ConditionCounts,
    location: 'Lighting Storage A',
    created_by_uid: 'uid-1',
    ...overrides,
  } as InventoryItem
}

describe('conditionSummaryLabel', () => {
  it('names the worst non-zero bucket', () => {
    expect(conditionSummaryLabel(item({ condition_counts: { ...EMPTY_CONDITION_COUNTS, good: 5, unusable: 1 } }))).toBe('Unusable')
  })

  it('says Unclassified when nothing is classified', () => {
    expect(conditionSummaryLabel(item({ condition_counts: EMPTY_CONDITION_COUNTS }))).toBe('Unclassified')
  })
})

describe('itemConditionTone', () => {
  it('carries the worst condition present through to the badge', () => {
    expect(itemConditionTone(item({ condition_counts: { ...EMPTY_CONDITION_COUNTS, unusable: 1 } })))
      .toBe('danger')
    expect(itemConditionTone(item({ condition_counts: { ...EMPTY_CONDITION_COUNTS, needs_repair: 1 } })))
      .toBe('caution')
  })

  it('agrees with the shared condition scale for a classified item', () => {
    expect(itemConditionTone(item({ condition_counts: { ...EMPTY_CONDITION_COUNTS, excellent: 3 } })))
      .toBe(conditionTone('excellent'))
    expect(itemConditionTone(item({ condition_counts: { ...EMPTY_CONDITION_COUNTS, fair: 3 } })))
      .toBe(conditionTone('fair'))
  })

  it('treats an unclassified item as neutral, not as healthy', () => {
    // Nobody has looked, which is a different claim from nothing being wrong.
    expect(itemConditionTone(item({ condition_counts: EMPTY_CONDITION_COUNTS }))).toBe('neutral')
  })
})

describe('teamNameOf and unclassifiedOf', () => {
  it('resolves the owning team', () => {
    expect(teamNameOf(item(), teams)).toBe('Lighting')
  })

  it('says Unknown team for an ID it cannot resolve', () => {
    expect(teamNameOf(item({ team_id: 't-gone' }), teams)).toBe('Unknown team')
  })

  it('reports the unclassified remainder', () => {
    expect(unclassifiedOf(item({ quantity_total: 12, condition_counts: { ...EMPTY_CONDITION_COUNTS, good: 9 } }))).toBe(3)
  })
})

describe('filterInventoryItems', () => {
  const items = [
    item({ item_id: 'i-1', name: 'Source Four', team_id: 't-lighting', quantity_available: 8 }),
    item({
      item_id: 'i-2',
      name: 'Velvet Cloak',
      category: 'Costumes',
      team_id: 't-costume',
      location: 'Costume Loft',
      quantity_available: 0,
      condition_counts: { ...EMPTY_CONDITION_COUNTS, needs_repair: 2 },
    }),
    item({
      item_id: 'i-3',
      name: 'XLR Cable',
      category: 'Cables',
      team_id: 't-lighting',
      notes: 'Coiled on the rack',
      condition_counts: EMPTY_CONDITION_COUNTS,
    }),
  ]

  it('returns everything with no filters', () => {
    expect(filterInventoryItems(items, EMPTY_FILTERS, teams)).toHaveLength(3)
  })

  it('matches text against name, category, location, notes, and team', () => {
    expect(filterInventoryItems(items, { ...EMPTY_FILTERS, text: 'velvet' }, teams)).toHaveLength(1)
    expect(filterInventoryItems(items, { ...EMPTY_FILTERS, text: 'cables' }, teams)).toHaveLength(1)
    expect(filterInventoryItems(items, { ...EMPTY_FILTERS, text: 'loft' }, teams)).toHaveLength(1)
    expect(filterInventoryItems(items, { ...EMPTY_FILTERS, text: 'coiled' }, teams)).toHaveLength(1)
    expect(filterInventoryItems(items, { ...EMPTY_FILTERS, text: 'costume' }, teams)).toHaveLength(1)
  })

  it('ignores case and surrounding space', () => {
    expect(filterInventoryItems(items, { ...EMPTY_FILTERS, text: '  SOURCE  ' }, teams)).toHaveLength(1)
  })

  it('filters by category and team', () => {
    expect(filterInventoryItems(items, { ...EMPTY_FILTERS, category: 'Cables' }, teams)).toHaveLength(1)
    expect(filterInventoryItems(items, { ...EMPTY_FILTERS, teamId: 't-lighting' }, teams)).toHaveLength(2)
  })

  it('filters by condition summary, including unclassified', () => {
    expect(filterInventoryItems(items, { ...EMPTY_FILTERS, condition: 'needs_repair' }, teams)).toHaveLength(1)
    expect(filterInventoryItems(items, { ...EMPTY_FILTERS, condition: 'unclassified' }, teams)).toHaveLength(1)
    expect(filterInventoryItems(items, { ...EMPTY_FILTERS, condition: 'good' }, teams)).toHaveLength(1)
  })

  it('filters by availability', () => {
    expect(filterInventoryItems(items, { ...EMPTY_FILTERS, availability: 'available' }, teams)).toHaveLength(2)
    expect(filterInventoryItems(items, { ...EMPTY_FILTERS, availability: 'unavailable' }, teams)).toHaveLength(1)
  })

  it('combines filters', () => {
    expect(
      filterInventoryItems(items, { ...EMPTY_FILTERS, teamId: 't-lighting', condition: 'unclassified' }, teams),
    ).toHaveLength(1)
    expect(
      filterInventoryItems(items, { ...EMPTY_FILTERS, teamId: 't-costume', availability: 'available' }, teams),
    ).toHaveLength(0)
  })
})
