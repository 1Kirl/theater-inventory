import { describe, expect, it } from 'vitest'
import { Timestamp } from 'firebase/firestore'
import {
  dashboardAccess, hasAnyAccess, isOpenRepair, summarizeInventory, summarizeMaintenance,
  summarizeProductions, upcomingEvents,
} from '@/features/dashboard/dashboard-summary'
import { EMPTY_CONDITION_COUNTS } from '@/domain/inventory'
import { currentlyInService } from '@/domain/maintenance'
import { shortageOf } from '@/domain/production'
import type { ConditionCounts, InventoryItem } from '@/types/inventory'
import type { MaintenanceRecord } from '@/types/maintenance'
import type { ActionItem, Production, ProductionRequirement } from '@/types/production'
import type { CalendarEvent } from '@/types/calendar'
import type { ModulePermissions } from '@/types/organization'

type Overrides<T> = { [K in keyof T]?: T[K] | undefined }

const NOW = new Date(2026, 7, 25, 10, 0, 0)

function permissions(overrides: Partial<ModulePermissions> = {}): ModulePermissions {
  return {
    inventory: 'none', maintenance: 'none', productions: 'none', calendar: 'none', ...overrides,
  }
}

function counts(overrides: Partial<ConditionCounts> = {}): ConditionCounts {
  return { ...EMPTY_CONDITION_COUNTS, ...overrides }
}

function item(overrides: Overrides<InventoryItem> = {}): InventoryItem {
  return {
    item_id: 'i-1',
    organization_id: 'org-1',
    name: 'Wireless Microphone',
    category: 'Microphones',
    team_id: 't-sound',
    quantity_total: 10,
    quantity_available: 8,
    condition_counts: counts({ good: 10 }),
    location: 'Storage',
    created_by_uid: 'u-1',
    ...overrides,
  } as unknown as InventoryItem
}

function record(overrides: Overrides<MaintenanceRecord> = {}): MaintenanceRecord {
  return {
    maintenance_id: 'm-1',
    organization_id: 'org-1',
    item_id: 'i-1',
    team_id: 't-sound',
    quantity_sent: 2,
    issue_description: 'Crackling audio',
    status: 'sent',
    created_by_uid: 'u-1',
    created_at: Timestamp.fromDate(new Date(2026, 7, 20)),
    ...overrides,
  } as unknown as MaintenanceRecord
}

function production(overrides: Overrides<Production> = {}): Production {
  return {
    production_id: 'p-1',
    organization_id: 'org-1',
    title: 'Spring Musical',
    status: 'active',
    created_by_uid: 'u-1',
    ...overrides,
  } as unknown as Production
}

function requirement(overrides: Overrides<ProductionRequirement> = {}): ProductionRequirement {
  return {
    requirement_id: 'r-1',
    organization_id: 'org-1',
    production_id: 'p-1',
    item_name: 'Wireless Microphones',
    inventory_item_id: 'i-1',
    required_qty: 12,
    team_id: 't-sound',
    source: 'manual',
    created_by_uid: 'u-1',
    ...overrides,
  } as unknown as ProductionRequirement
}

function action(overrides: Overrides<ActionItem> = {}): ActionItem {
  return {
    action_item_id: 'r-1',
    organization_id: 'org-1',
    production_id: 'p-1',
    requirement_id: 'r-1',
    item_name: 'Wireless Microphones',
    action_type: 'rent',
    quantity: 4,
    team_id: 't-sound',
    status: 'todo',
    created_by_uid: 'u-1',
    ...overrides,
  } as unknown as ActionItem
}

function event(overrides: Overrides<CalendarEvent> = {}): CalendarEvent {
  return {
    event_id: 'e-1',
    organization_id: 'org-1',
    title: 'Tech Rehearsal',
    event_type: 'Rehearsal',
    event_date: Timestamp.fromDate(new Date(2026, 7, 26)),
    visibility: 'all_teams',
    team_ids: [],
    created_by_uid: 'u-1',
    ...overrides,
  } as unknown as CalendarEvent
}

describe('dashboardAccess', () => {
  it('hides every card from a member with no module permission', () => {
    // Unreachable through the normal role computation, which demotes such a
    // membership to unassigned, but the dashboard does not depend on that.
    const access = dashboardAccess('member', permissions())

    expect(access).toEqual({
      inventory: false, maintenance: false, productions: false, calendar: false,
    })
    expect(hasAnyAccess(access)).toBe(false)
  })

  it('shows a card for a module at view', () => {
    const access = dashboardAccess('member', permissions({ inventory: 'view' }))

    expect(access.inventory).toBe(true)
    expect(access.maintenance).toBe(false)
    expect(hasAnyAccess(access)).toBe(true)
  })

  it('shows a card for a module at edit', () => {
    expect(dashboardAccess('member', permissions({ calendar: 'edit' })).calendar).toBe(true)
  })

  it('gives an Admin every card regardless of the permission map', () => {
    expect(dashboardAccess('admin', permissions())).toEqual({
      inventory: true, maintenance: true, productions: true, calendar: true,
    })
  })

  it('gives an unassigned member nothing', () => {
    expect(hasAnyAccess(dashboardAccess('unassigned', permissions({ inventory: 'edit' }))))
      .toBe(false)
  })

  it('gives a signed-out state nothing', () => {
    expect(hasAnyAccess(dashboardAccess(null, null))).toBe(false)
  })
})

describe('summarizeInventory', () => {
  it('counts records and units without inventing either', () => {
    const summary = summarizeInventory([
      item({ quantity_total: 10, quantity_available: 8 }),
      item({ item_id: 'i-2', quantity_total: 4, quantity_available: 0 }),
    ])

    expect(summary.itemCount).toBe(2)
    expect(summary.totalUnits).toBe(14)
    expect(summary.availableUnits).toBe(8)
  })

  it('uses the existing condition summary to decide what needs attention', () => {
    const summary = summarizeInventory([
      item({ item_id: 'a', condition_counts: counts({ good: 10 }) }),
      item({ item_id: 'b', condition_counts: counts({ needs_repair: 6, good: 4 }) }),
      item({ item_id: 'c', condition_counts: counts({ unusable: 3 }) }),
      item({ item_id: 'd', condition_counts: counts() }),
    ])

    // b is mostly needing repair, c is unusable; d has nothing recorded and is
    // not counted as a problem.
    expect(summary.needsAttentionCount).toBe(2)
  })

  it('handles an organization with no inventory', () => {
    expect(summarizeInventory([])).toEqual({
      itemCount: 0, totalUnits: 0, availableUnits: 0, needsAttentionCount: 0,
    })
  })
})

describe('summarizeMaintenance', () => {
  const records = [
    record({ maintenance_id: 'a', status: 'planned', quantity_sent: 1 }),
    record({ maintenance_id: 'b', status: 'sent', quantity_sent: 2 }),
    record({ maintenance_id: 'c', status: 'in_service', quantity_sent: 3 }),
    record({ maintenance_id: 'd', status: 'returned', quantity_sent: 4 }),
    record({ maintenance_id: 'e', status: 'cancelled', quantity_sent: 5 }),
  ]

  it('counts a repair as open until it is returned or cancelled', () => {
    expect(summarizeMaintenance(records, NOW).openCount).toBe(3)
    expect(isOpenRepair({ status: 'planned' })).toBe(true)
    expect(isOpenRepair({ status: 'returned' })).toBe(false)
    expect(isOpenRepair({ status: 'cancelled' })).toBe(false)
  })

  it('reuses the existing in-service rule rather than restating it', () => {
    const summary = summarizeMaintenance(records, NOW)

    // Sent, in service, and ready only: a planned repair has not left yet.
    expect(summary.inServiceQuantity).toBe(5)
    expect(summary.inServiceQuantity).toBe(currentlyInService(records))
  })

  it('reuses the existing overdue rule', () => {
    const summary = summarizeMaintenance([
      record({
        maintenance_id: 'late',
        status: 'in_service',
        expected_return_at: Timestamp.fromDate(new Date(2026, 7, 1)),
      }),
      record({
        maintenance_id: 'soon',
        status: 'in_service',
        expected_return_at: Timestamp.fromDate(new Date(2026, 8, 30)),
      }),
      record({
        maintenance_id: 'back',
        status: 'returned',
        expected_return_at: Timestamp.fromDate(new Date(2026, 7, 1)),
      }),
    ], NOW)

    expect(summary.overdueCount).toBe(1)
  })

  it('lists the most recently logged records first', () => {
    const summary = summarizeMaintenance([
      record({ maintenance_id: 'old', created_at: Timestamp.fromDate(new Date(2026, 6, 1)) }),
      record({ maintenance_id: 'new', created_at: Timestamp.fromDate(new Date(2026, 7, 24)) }),
    ], NOW)

    expect(summary.recent.map((entry) => entry.maintenance_id)).toEqual(['new', 'old'])
  })

  it('caps the recent list', () => {
    const many = Array.from({ length: 12 }, (_, index) => record({ maintenance_id: `m-${index}` }))
    expect(summarizeMaintenance(many, NOW, 5).recent).toHaveLength(5)
  })

  it('handles an organization with no maintenance records', () => {
    const summary = summarizeMaintenance([], NOW)

    expect(summary.openCount).toBe(0)
    expect(summary.inServiceQuantity).toBe(0)
    expect(summary.recent).toEqual([])
  })
})

describe('summarizeProductions', () => {
  const base = {
    productions: [
      production({ production_id: 'p-1', status: 'active' }),
      production({ production_id: 'p-2', status: 'planning' }),
      production({ production_id: 'p-3', status: 'completed' }),
    ],
    requirements: [
      requirement({ requirement_id: 'r-1', production_id: 'p-1', required_qty: 12 }),
      requirement({ requirement_id: 'r-2', production_id: 'p-1', required_qty: 4 }),
      requirement({ requirement_id: 'r-3', production_id: 'p-2', required_qty: 99 }),
    ],
    actions: [
      action({ action_item_id: 'r-1', requirement_id: 'r-1', production_id: 'p-1', status: 'todo' }),
      action({ action_item_id: 'r-2', requirement_id: 'r-2', production_id: 'p-1', status: 'done' }),
    ],
    items: [item({ item_id: 'i-1', quantity_available: 8 })],
  }

  it('counts only active productions', () => {
    const summary = summarizeProductions({ ...base, canReadInventory: true })
    expect(summary.activeCount).toBe(1)
  })

  it('counts only open actions, using the existing rule', () => {
    const summary = summarizeProductions({ ...base, canReadInventory: true })
    expect(summary.openActionCount).toBe(1)
  })

  it('reuses the Phase 5 shortage calculation', () => {
    const summary = summarizeProductions({ ...base, canReadInventory: true })

    // r-1 wants 12 against 8 available; r-2 wants 4 and is covered. The planning
    // production's requirement is not counted.
    expect(summary.shortageCount).toBe(1)
    expect(shortageOf(12, 8)).toBe(4)
    expect(shortageOf(4, 8)).toBe(0)
  })

  it('does not subtract equipment that is out for service', () => {
    // Decision 46: availability is quantity_available, unadjusted.
    const summary = summarizeProductions({
      ...base,
      items: [item({ item_id: 'i-1', quantity_available: 12, quantity_total: 20 })],
      canReadInventory: true,
    })

    expect(summary.shortageCount).toBe(0)
  })

  it('reports null rather than zero when inventory could not be read', () => {
    // Zero would read as "nothing is short", which is a different claim.
    const summary = summarizeProductions({ ...base, items: [], canReadInventory: false })

    expect(summary.shortageCount).toBeNull()
    expect(summary.active[0]?.shortageCount).toBeNull()
    // The figures that do not need inventory are still reported.
    expect(summary.activeCount).toBe(1)
    expect(summary.openActionCount).toBe(1)
  })

  it('breaks the active productions down individually', () => {
    const summary = summarizeProductions({ ...base, canReadInventory: true })
    const [row] = summary.active

    expect(row?.production.production_id).toBe('p-1')
    expect(row?.requirementCount).toBe(2)
    expect(row?.shortageCount).toBe(1)
    expect(row?.openActionCount).toBe(1)
  })

  it('caps how many active productions are listed', () => {
    const many = Array.from({ length: 8 }, (_, index) =>
      production({ production_id: `p-${index}`, status: 'active' }))

    const summary = summarizeProductions({
      productions: many, requirements: [], actions: [], items: [], canReadInventory: true, limit: 3,
    })

    expect(summary.activeCount).toBe(8)
    expect(summary.active).toHaveLength(3)
  })

  it('handles an organization with no productions', () => {
    const summary = summarizeProductions({
      productions: [], requirements: [], actions: [], items: [], canReadInventory: true,
    })

    expect(summary).toEqual({
      activeCount: 0, openActionCount: 0, shortageCount: 0, active: [],
    })
  })
})

describe('upcomingEvents', () => {
  it('keeps today and drops yesterday', () => {
    const events = [
      event({ event_id: 'today', event_date: Timestamp.fromDate(new Date(2026, 7, 25)) }),
      event({ event_id: 'past', event_date: Timestamp.fromDate(new Date(2026, 7, 24)) }),
      event({ event_id: 'future', event_date: Timestamp.fromDate(new Date(2026, 7, 30)) }),
    ]

    expect(upcomingEvents(events, NOW).map((entry) => entry.event_id))
      .toEqual(['today', 'future'])
  })

  it('compares by local date, so an early event does not fall into yesterday', () => {
    // NOW is 10:00; an event at local midnight today is still today.
    const midnight = event({
      event_id: 'midnight', event_date: Timestamp.fromDate(new Date(2026, 7, 25, 0, 0, 0)),
    })

    expect(upcomingEvents([midnight], NOW)).toHaveLength(1)
  })

  it('orders by the calendar rules: all-day first, then start time, then title', () => {
    const sameDay = new Date(2026, 7, 26)
    const events = [
      event({ event_id: 'evening', event_date: Timestamp.fromDate(sameDay), start_time: '19:00' }),
      event({ event_id: 'allday', event_date: Timestamp.fromDate(sameDay) }),
      event({ event_id: 'morning', event_date: Timestamp.fromDate(sameDay), start_time: '09:00' }),
    ]

    expect(upcomingEvents(events, NOW).map((entry) => entry.event_id))
      .toEqual(['allday', 'morning', 'evening'])
  })

  it('caps the list', () => {
    const many = Array.from({ length: 12 }, (_, index) =>
      event({ event_id: `e-${index}`, event_date: Timestamp.fromDate(new Date(2026, 8, index + 1)) }))

    expect(upcomingEvents(many, NOW, 5)).toHaveLength(5)
  })

  it('handles an organization with nothing scheduled', () => {
    expect(upcomingEvents([], NOW)).toEqual([])
  })
})
