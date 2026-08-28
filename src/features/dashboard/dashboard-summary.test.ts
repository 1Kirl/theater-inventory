import { describe, expect, it } from 'vitest'
import { Timestamp } from 'firebase/firestore'
import {
  dashboardAccess, hasAnyAccess, summarizeCalendar, summarizeInventory,
  summarizeMaintenance, summarizeProductions, upcomingEvents,
} from '@/features/dashboard/dashboard-summary'
import { EMPTY_CONDITION_COUNTS } from '@/domain/inventory'
import { currentlyInService, isOpenStatus } from '@/domain/maintenance'
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
      itemCount: 0, totalUnits: 0, availableUnits: 0, needsAttentionCount: 0, lostUnits: 0,
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
    expect(isOpenStatus('planned')).toBe(true)
    expect(isOpenStatus('returned')).toBe(false)
    expect(isOpenStatus('cancelled')).toBe(false)
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

  it('does not cap: counting and previewing are different questions', () => {
    const many = Array.from({ length: 12 }, (_, index) =>
      event({ event_id: `e-${index}`, event_date: Timestamp.fromDate(new Date(2026, 8, index + 1)) }))

    expect(upcomingEvents(many, NOW)).toHaveLength(12)
  })

  it('handles an organization with nothing scheduled', () => {
    expect(upcomingEvents([], NOW)).toEqual([])
  })
})

describe('summarizeCalendar', () => {
  /** The seeded demo calendar: six events, all ahead of today. */
  function seededSix() {
    return [3, 5, 7, 10, 14, 21].map((days) => event({
      event_id: `e+${days}`,
      event_date: Timestamp.fromDate(new Date(2026, 7, 25 + days)),
    }))
  }

  it('counts every upcoming event, not just the ones it previews', () => {
    // The bug this replaces: the summary read its number off the preview list,
    // so six upcoming events were reported as five.
    const summary = summarizeCalendar(seededSix(), NOW)

    expect(summary.upcomingCount).toBe(6)
  })

  it('still caps the preview at five', () => {
    const summary = summarizeCalendar(seededSix(), NOW)

    expect(summary.preview).toHaveLength(5)
    expect(summary.preview.map((entry) => entry.event_id))
      .toEqual(['e+3', 'e+5', 'e+7', 'e+10', 'e+14'])
  })

  it('counts past the preview limit without bound', () => {
    const many = Array.from({ length: 40 }, (_, index) => event({
      event_id: `e-${index}`,
      event_date: Timestamp.fromDate(new Date(2026, 8, index + 1)),
    }))

    const summary = summarizeCalendar(many, NOW)

    expect(summary.upcomingCount).toBe(40)
    expect(summary.preview).toHaveLength(5)
  })

  it('counts today and excludes yesterday', () => {
    const summary = summarizeCalendar([
      event({ event_id: 'yesterday', event_date: Timestamp.fromDate(new Date(2026, 7, 24)) }),
      event({ event_id: 'today', event_date: Timestamp.fromDate(new Date(2026, 7, 25)) }),
      event({ event_id: 'tomorrow', event_date: Timestamp.fromDate(new Date(2026, 7, 26)) }),
    ], NOW)

    expect(summary.upcomingCount).toBe(2)
    expect(summary.preview.map((entry) => entry.event_id)).toEqual(['today', 'tomorrow'])
  })

  it('counts an event at local midnight today, with no UTC shift', () => {
    // NOW is 10:00 local. A UTC comparison would push this into yesterday for
    // anyone east of Greenwich and drop it from the count.
    const summary = summarizeCalendar([
      event({ event_id: 'midnight', event_date: Timestamp.fromDate(new Date(2026, 7, 25, 0, 0, 0)) }),
    ], NOW)

    expect(summary.upcomingCount).toBe(1)
  })

  it('reports zero and an empty preview for an organization with nothing scheduled', () => {
    expect(summarizeCalendar([], NOW)).toEqual({ upcomingCount: 0, preview: [] })
  })

  it('honours a different preview limit without changing the count', () => {
    const summary = summarizeCalendar(seededSix(), NOW, 2)

    expect(summary.upcomingCount).toBe(6)
    expect(summary.preview).toHaveLength(2)
  })
})

describe('no other summary lets a preview cap reach its count', () => {
  it('counts every open repair while previewing only the most recent', () => {
    const many = Array.from({ length: 9 }, (_, index) =>
      record({ maintenance_id: `m-${index}`, status: 'sent', quantity_sent: 1 }))

    const summary = summarizeMaintenance(many, NOW, 3)

    expect(summary.openCount).toBe(9)
    expect(summary.inServiceQuantity).toBe(9)
    expect(summary.recent).toHaveLength(3)
  })

  it('counts every active production while previewing only a few', () => {
    const many = Array.from({ length: 7 }, (_, index) =>
      production({ production_id: `p-${index}`, status: 'active' }))
    const actions = many.map((entry, index) => action({
      action_item_id: `r-${index}`,
      requirement_id: `r-${index}`,
      production_id: entry.production_id,
      status: 'todo',
    }))

    const summary = summarizeProductions({
      productions: many, requirements: [], actions, items: [], canReadInventory: true, limit: 2,
    })

    expect(summary.activeCount).toBe(7)
    expect(summary.openActionCount).toBe(7)
    expect(summary.active).toHaveLength(2)
  })
})

describe('what counts as equipment currently away for repair', () => {
  function bulkRecord(overrides: Partial<MaintenanceRecord> = {}): MaintenanceRecord {
    return {
      maintenance_id: 'rec-bulk',
      status: 'in_service',
      quantity_sent: 4,
      created_at: Timestamp.fromMillis(1_000),
      ...overrides,
    } as MaintenanceRecord
  }

  function serializedRecord(overrides: Partial<MaintenanceRecord> = {}): MaintenanceRecord {
    return {
      ...bulkRecord({ maintenance_id: 'rec-serial', ...overrides }),
      tracking_mode: 'serialized',
      unit_ids: ['u1', 'u2', 'u3'],
      quantity_sent: 3,
    } as MaintenanceRecord
  }

  function serializedItem(inMaintenance: number): InventoryItem {
    return {
      item_id: 'item-1',
      tracking_mode: 'serialized',
      quantity_total: 10,
      quantity_available: 10 - inMaintenance,
      condition_counts: EMPTY_CONDITION_COUNTS,
      unit_counts: {
        active_total: 10,
        available: 10 - inMaintenance,
        unusable_on_hand: 0,
        in_use: 0,
        in_maintenance: inMaintenance,
        lost: 0,
        retired: 0,
      },
    } as InventoryItem
  }

  const now = new Date('2026-08-29T00:00:00Z')

  it('counts a bulk repair from its own record, as before', () => {
    expect(summarizeMaintenance([bulkRecord()], now, 5, []).inServiceQuantity).toBe(4)
  })

  it('counts serialized equipment from the item, not the repair record', () => {
    // The units count themselves. The record is skipped so the same clamp is
    // not counted twice.
    const summary = summarizeMaintenance([serializedRecord()], now, 5, [serializedItem(3)])

    expect(summary.inServiceQuantity).toBe(3)
  })

  it('does not double count when both are present', () => {
    const summary = summarizeMaintenance(
      [bulkRecord(), serializedRecord()], now, 5, [serializedItem(3)],
    )

    expect(summary.inServiceQuantity).toBe(7)
  })

  it('trusts the item over a repair record that disagrees', () => {
    // A record claiming ten while the equipment says three: the equipment wins.
    const summary = summarizeMaintenance(
      [serializedRecord({ quantity_sent: 10 })], now, 5, [serializedItem(3)],
    )

    expect(summary.inServiceQuantity).toBe(3)
  })

  it('counts nothing for a serialized item with nothing away', () => {
    expect(summarizeMaintenance([], now, 5, [serializedItem(0)]).inServiceQuantity).toBe(0)
  })

  it('still counts repair records, serialized or not, as open jobs', () => {
    // Active Repairs counts repairs, not pieces of equipment, so it is
    // unaffected by any of this.
    const summary = summarizeMaintenance(
      [bulkRecord(), serializedRecord()], now, 5, [serializedItem(3)],
    )

    expect(summary.openCount).toBe(2)
  })
})
