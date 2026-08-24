import { Timestamp } from 'firebase/firestore'
import { describe, expect, it } from 'vitest'
import {
  EMPTY_MAINTENANCE_FILTERS,
  filterMaintenanceRecords,
  statusTone,
  teamDisplay,
} from '@/features/maintenance/maintenance-view'
import type { MaintenanceRecord, MaintenanceStatus } from '@/types/maintenance'
import type { InventoryItem } from '@/types/inventory'
import type { TheaterTeam } from '@/types/organization'

const teams = [
  { team_id: 't-lighting', name: 'Lighting' },
  { team_id: 't-costume', name: 'Costume' },
] as TheaterTeam[]

const items = [
  { item_id: 'i-1', name: 'Source Four', team_id: 't-lighting' },
  { item_id: 'i-2', name: 'Velvet Cloak', team_id: 't-costume' },
] as InventoryItem[]

function record(overrides: Partial<MaintenanceRecord> = {}): MaintenanceRecord {
  return {
    maintenance_id: 'm-1',
    organization_id: 'org-1',
    item_id: 'i-1',
    team_id: 't-lighting',
    quantity_sent: 2,
    issue_description: 'Lamp housing cracked',
    status: 'sent' as MaintenanceStatus,
    service_provider_name: 'City Stage Service',
    created_by_uid: 'uid-1',
    ...overrides,
  } as MaintenanceRecord
}

describe('statusTone', () => {
  it('marks equipment that is out as active', () => {
    for (const status of ['sent', 'in_service', 'ready'] as const) {
      expect(statusTone(status)).toBe('active')
    }
  })

  it('marks planned as pending and finished states as done', () => {
    expect(statusTone('planned')).toBe('pending')
    expect(statusTone('returned')).toBe('done')
    expect(statusTone('cancelled')).toBe('done')
  })
})

describe('teamDisplay', () => {
  it('shows the team plainly when it still matches the item', () => {
    const display = teamDisplay(record(), items, teams)
    expect(display.historical).toBe(false)
    expect(display.label).toBe('Lighting')
  })

  it('says the team is historical when the item has moved', () => {
    const moved = [{ ...items[0]!, team_id: 't-costume' }, items[1]!] as InventoryItem[]
    const display = teamDisplay(record(), moved, teams)

    expect(display.historical).toBe(true)
    expect(display.label).toBe('Team at time of service: Lighting')
  })

  it('does not claim history when the item cannot be resolved', () => {
    const display = teamDisplay(record({ item_id: 'i-gone' }), items, teams)
    expect(display.historical).toBe(false)
  })
})

describe('filterMaintenanceRecords', () => {
  const now = new Date('2026-08-24T12:00:00Z')
  const past = Timestamp.fromDate(new Date('2026-08-01T00:00:00Z'))

  const records = [
    record({ maintenance_id: 'm-1', status: 'sent', expected_return_at: past }),
    record({
      maintenance_id: 'm-2',
      item_id: 'i-2',
      team_id: 't-costume',
      status: 'returned',
      issue_description: 'Hem torn',
      service_provider_name: 'Threadworks',
    }),
    record({ maintenance_id: 'm-3', status: 'planned', issue_description: 'Annual service' }),
  ]

  const context = { items, teams, now }

  it('returns everything with no filters', () => {
    expect(filterMaintenanceRecords(records, EMPTY_MAINTENANCE_FILTERS, context)).toHaveLength(3)
  })

  it('searches item name, team, issue, provider, and notes', () => {
    expect(filterMaintenanceRecords(records, { ...EMPTY_MAINTENANCE_FILTERS, text: 'velvet' }, context)).toHaveLength(1)
    expect(filterMaintenanceRecords(records, { ...EMPTY_MAINTENANCE_FILTERS, text: 'costume' }, context)).toHaveLength(1)
    expect(filterMaintenanceRecords(records, { ...EMPTY_MAINTENANCE_FILTERS, text: 'threadworks' }, context)).toHaveLength(1)
    expect(filterMaintenanceRecords(records, { ...EMPTY_MAINTENANCE_FILTERS, text: 'annual' }, context)).toHaveLength(1)
  })

  it('filters by a specific status', () => {
    expect(filterMaintenanceRecords(records, { ...EMPTY_MAINTENANCE_FILTERS, status: 'returned' }, context)).toHaveLength(1)
  })

  it('offers an active shorthand covering all three out-for-service statuses', () => {
    expect(filterMaintenanceRecords(records, { ...EMPTY_MAINTENANCE_FILTERS, status: 'active' }, context)).toHaveLength(1)
  })

  it('filters by team snapshot', () => {
    expect(filterMaintenanceRecords(records, { ...EMPTY_MAINTENANCE_FILTERS, teamId: 't-costume' }, context)).toHaveLength(1)
  })

  it('filters overdue records', () => {
    expect(filterMaintenanceRecords(records, { ...EMPTY_MAINTENANCE_FILTERS, overdue: 'overdue' }, context)).toHaveLength(1)
  })

  it('combines filters', () => {
    expect(
      filterMaintenanceRecords(records, { ...EMPTY_MAINTENANCE_FILTERS, status: 'active', teamId: 't-costume' }, context),
    ).toHaveLength(0)
  })
})
