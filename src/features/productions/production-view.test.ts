import { describe, expect, it } from 'vitest'
import {
  EMPTY_ACTION_FILTERS,
  NOT_MATCHED,
  actionPlaceholder,
  actionSummary,
  availabilityLabel,
  buildRequirementRows,
  filterActionItems,
  matchedItemName,
  shortageLabel,
  summarizeProduction,
} from '@/features/productions/production-view'
import type { InventoryItem } from '@/types/inventory'
import type { ActionItem, Production, ProductionRequirement } from '@/types/production'
import type { TheaterTeam } from '@/types/organization'

const teams = [
  { team_id: 't-sound', name: 'Sound' },
  { team_id: 't-costume', name: 'Costume' },
] as TheaterTeam[]

const items = [
  { item_id: 'i-mic', name: 'Shure BLX', quantity_available: 5 },
  { item_id: 'i-cable', name: 'XLR Cable', quantity_available: 45 },
] as InventoryItem[]

type Overrides<T> = { [K in keyof T]?: T[K] | undefined }

function requirement(o: Overrides<ProductionRequirement> = {}): ProductionRequirement {
  return {
    requirement_id: 'r-1', organization_id: 'org-1', production_id: 'p-1',
    item_name: 'Wireless Microphone', inventory_item_id: 'i-mic',
    required_qty: 8, team_id: 't-sound', source: 'manual', created_by_uid: 'u-1',
    ...o,
  } as ProductionRequirement
}

function action(o: Overrides<ActionItem> = {}): ActionItem {
  return {
    action_item_id: 'r-1', organization_id: 'org-1', production_id: 'p-1',
    requirement_id: 'r-1', item_name: 'Wireless Microphone', action_type: 'rent',
    quantity: 3, team_id: 't-sound', status: 'todo', created_by_uid: 'u-1',
    ...o,
  } as ActionItem
}

describe('availability and shortage labels', () => {
  it('shows numbers for a matched requirement', () => {
    const rows = buildRequirementRows({ requirements: [requirement()], items, actions: [], teams })
    expect(availabilityLabel(rows[0]!.availability)).toBe('5')
    expect(shortageLabel(rows[0]!.availability)).toBe('3')
  })

  it('shows Not Matched for both when unlinked', () => {
    const rows = buildRequirementRows({
      requirements: [requirement({ inventory_item_id: undefined })], items, actions: [], teams,
    })
    expect(availabilityLabel(rows[0]!.availability)).toBe(NOT_MATCHED)
    expect(shortageLabel(rows[0]!.availability)).toBe(NOT_MATCHED)
  })
})

describe('actionPlaceholder', () => {
  it('offers nothing for an unmatched requirement', () => {
    expect(actionPlaceholder({ matched: false })).toBe('—')
  })

  it('says Already Available when the shortage is zero', () => {
    expect(actionPlaceholder({ matched: true, available: 45, shortage: 0, alreadyAvailable: true }))
      .toBe('Already Available')
  })

  it('invites an action when short', () => {
    expect(actionPlaceholder({ matched: true, available: 5, shortage: 3, alreadyAvailable: false }))
      .toBe('No action yet')
  })
})

describe('actionSummary', () => {
  it('reads as the plan, not the shortage', () => {
    expect(actionSummary(action({ action_type: 'rent', quantity: 3 }))).toBe('Rent 3')
    expect(actionSummary(action({ action_type: 'build', quantity: 1 }))).toBe('Build 1')
  })
})

describe('matchedItemName', () => {
  it('names the matched item', () => {
    expect(matchedItemName(requirement(), items)).toBe('Shure BLX')
  })

  it('says Not Matched when unlinked or unreadable', () => {
    expect(matchedItemName(requirement({ inventory_item_id: undefined }), items)).toBe(NOT_MATCHED)
    expect(matchedItemName(requirement({ inventory_item_id: 'i-gone' }), items)).toBe(NOT_MATCHED)
  })
})

describe('buildRequirementRows', () => {
  it('joins each requirement with its availability, action, and names', () => {
    const rows = buildRequirementRows({
      requirements: [requirement()], items, actions: [action()], teams,
    })

    expect(rows).toHaveLength(1)
    expect(rows[0]!.teamName).toBe('Sound')
    expect(rows[0]!.matchedName).toBe('Shure BLX')
    expect(rows[0]!.action?.quantity).toBe(3)
    expect(rows[0]!.availability).toMatchObject({ shortage: 3 })
  })

  it('leaves the action null when none exists', () => {
    const rows = buildRequirementRows({ requirements: [requirement()], items, actions: [], teams })
    expect(rows[0]!.action).toBeNull()
  })
})

describe('summarizeProduction', () => {
  it('counts requirements, shortages, and open actions separately', () => {
    const rows = buildRequirementRows({
      requirements: [
        requirement({ requirement_id: 'r-1' }),
        requirement({ requirement_id: 'r-2', inventory_item_id: 'i-cable', required_qty: 10 }),
        requirement({ requirement_id: 'r-3', inventory_item_id: undefined }),
      ],
      items,
      actions: [action({ requirement_id: 'r-1', status: 'todo' })],
      teams,
    })

    expect(summarizeProduction(rows)).toEqual({
      requirementCount: 3,
      shortageCount: 1,
      openActionCount: 1,
    })
  })

  it('excludes finished actions from the open count', () => {
    const rows = buildRequirementRows({
      requirements: [requirement()], items, actions: [action({ status: 'done' })], teams,
    })
    expect(summarizeProduction(rows).openActionCount).toBe(0)
  })

  it('counts nothing for an empty production', () => {
    expect(summarizeProduction([])).toEqual({ requirementCount: 0, shortageCount: 0, openActionCount: 0 })
  })
})

describe('filterActionItems', () => {
  const productions = [
    { production_id: 'p-1', title: 'Spring Musical' },
    { production_id: 'p-2', title: 'Fall Play' },
  ] as Production[]

  const actions = [
    action({ action_item_id: 'r-1', requirement_id: 'r-1', action_type: 'rent', status: 'todo' }),
    action({
      action_item_id: 'r-2', requirement_id: 'r-2', production_id: 'p-2', team_id: 't-costume',
      item_name: 'Velvet Cloak', action_type: 'build', status: 'done',
    }),
  ]

  const context = { productions, teams }

  it('returns everything with no filters', () => {
    expect(filterActionItems(actions, EMPTY_ACTION_FILTERS, context)).toHaveLength(2)
  })

  it('searches item, production, team, type, status, and notes', () => {
    expect(filterActionItems(actions, { ...EMPTY_ACTION_FILTERS, text: 'velvet' }, context)).toHaveLength(1)
    expect(filterActionItems(actions, { ...EMPTY_ACTION_FILTERS, text: 'spring' }, context)).toHaveLength(1)
    expect(filterActionItems(actions, { ...EMPTY_ACTION_FILTERS, text: 'costume' }, context)).toHaveLength(1)
    expect(filterActionItems(actions, { ...EMPTY_ACTION_FILTERS, text: 'rent' }, context)).toHaveLength(1)
  })

  it('filters by production, team, and action type', () => {
    expect(filterActionItems(actions, { ...EMPTY_ACTION_FILTERS, productionId: 'p-2' }, context)).toHaveLength(1)
    expect(filterActionItems(actions, { ...EMPTY_ACTION_FILTERS, teamId: 't-sound' }, context)).toHaveLength(1)
    expect(filterActionItems(actions, { ...EMPTY_ACTION_FILTERS, actionType: 'build' }, context)).toHaveLength(1)
  })

  it('offers an open shorthand covering unfinished work', () => {
    expect(filterActionItems(actions, { ...EMPTY_ACTION_FILTERS, status: 'open' }, context)).toHaveLength(1)
  })

  it('filters by an exact status', () => {
    expect(filterActionItems(actions, { ...EMPTY_ACTION_FILTERS, status: 'done' }, context)).toHaveLength(1)
  })

  it('combines filters', () => {
    expect(filterActionItems(actions, { ...EMPTY_ACTION_FILTERS, teamId: 't-sound', status: 'done' }, context)).toHaveLength(0)
  })
})
