import { MAINTENANCE_STATUS_LABELS, isActiveStatus, isOverdue } from '@/domain/maintenance'
import type { MaintenanceRecord, MaintenanceStatus } from '@/types/maintenance'
import type { InventoryItem } from '@/types/inventory'
import type { TheaterTeam } from '@/types/organization'

/** Presentation helpers, pure so the list, detail, and item history agree. */

export function statusLabel(status: MaintenanceStatus): string {
  return MAINTENANCE_STATUS_LABELS[status]
}

/** The shared tone vocabulary; see `@/domain/status-tone`. */
export { maintenanceStatusTone } from '@/domain/status-tone'

export function teamNameById(teamId: string, teams: readonly TheaterTeam[]): string {
  return teams.find((team) => team.team_id === teamId)?.name ?? 'Unknown team'
}

export function itemNameById(itemId: string, items: readonly InventoryItem[]): string {
  return items.find((item) => item.item_id === itemId)?.name ?? 'Unknown item'
}

/**
 * How to present the team on a record.
 *
 * The stored team is a snapshot of who sent the equipment out. Where the item
 * has since moved to another team, saying so plainly is more honest than
 * showing a team that was never responsible for the repair.
 */
export interface TeamDisplay {
  name: string
  historical: boolean
  label: string
}

export function teamDisplay(
  record: Pick<MaintenanceRecord, 'team_id' | 'item_id'>,
  items: readonly InventoryItem[],
  teams: readonly TheaterTeam[],
): TeamDisplay {
  const name = teamNameById(record.team_id, teams)
  const item = items.find((entry) => entry.item_id === record.item_id)
  const historical = item !== undefined && item.team_id !== record.team_id

  return {
    name,
    historical,
    label: historical ? `Team at time of service: ${name}` : name,
  }
}

export interface MaintenanceFilters {
  text: string
  status: string
  teamId: string
  overdue: string
}

export const EMPTY_MAINTENANCE_FILTERS: MaintenanceFilters = {
  text: '',
  status: 'all',
  teamId: 'all',
  overdue: 'all',
}

/**
 * Deterministic search over records the caller is already permitted to read.
 * This narrows an authorized result set; it is not what keeps anyone out.
 */
export function filterMaintenanceRecords(
  records: readonly MaintenanceRecord[],
  filters: MaintenanceFilters,
  context: { items: readonly InventoryItem[]; teams: readonly TheaterTeam[]; now: Date },
): MaintenanceRecord[] {
  const text = filters.text.trim().toLowerCase()

  return records.filter((record) => {
    if (text.length > 0) {
      const haystack = [
        itemNameById(record.item_id, context.items),
        teamNameById(record.team_id, context.teams),
        record.issue_description,
        record.service_provider_name ?? '',
        record.repair_notes ?? '',
      ]
        .join(' ')
        .toLowerCase()

      if (!haystack.includes(text)) return false
    }

    if (filters.status === 'active' && !isActiveStatus(record.status)) return false
    if (filters.status !== 'all' && filters.status !== 'active' && record.status !== filters.status) {
      return false
    }

    if (filters.teamId !== 'all' && record.team_id !== filters.teamId) return false

    if (filters.overdue === 'overdue' && !isOverdue(record, context.now)) return false

    return true
  })
}
