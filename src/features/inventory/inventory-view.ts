import { CONDITION_LABELS, conditionSummary, unclassifiedCount } from '@/domain/inventory'
import type { InventoryItem } from '@/types/inventory'
import type { TheaterTeam } from '@/types/organization'

/** Presentation helpers, kept pure so the list and detail agree on wording. */

export function conditionSummaryLabel(item: Pick<InventoryItem, 'condition_counts'>): string {
  const summary = conditionSummary(item.condition_counts)
  return summary ? CONDITION_LABELS[summary] : 'Unclassified'
}

export type ConditionTone = 'destructive' | 'warning' | 'muted' | 'neutral'

export function conditionTone(item: Pick<InventoryItem, 'condition_counts'>): ConditionTone {
  const summary = conditionSummary(item.condition_counts)

  if (summary === 'unusable') return 'destructive'
  if (summary === 'needs_repair') return 'warning'
  if (summary === null) return 'muted'
  return 'neutral'
}

export function teamNameOf(
  item: Pick<InventoryItem, 'team_id'>,
  teams: readonly TheaterTeam[],
): string {
  return teams.find((team) => team.team_id === item.team_id)?.name ?? 'Unknown team'
}

export function unclassifiedOf(
  item: Pick<InventoryItem, 'quantity_total' | 'condition_counts'>,
): number {
  return unclassifiedCount(item.quantity_total, item.condition_counts)
}

export interface InventoryFilters {
  text: string
  category: string
  teamId: string
  condition: string
  availability: string
}

export const EMPTY_FILTERS: InventoryFilters = {
  text: '',
  category: 'all',
  teamId: 'all',
  condition: 'all',
  availability: 'all',
}

/**
 * Deterministic search over items the caller is already permitted to read.
 *
 * This narrows a result set Security Rules have already authorized; it is not
 * what keeps anyone out. Reading is organization-wide by design, so there is no
 * team boundary to enforce here.
 */
export function filterInventoryItems(
  items: readonly InventoryItem[],
  filters: InventoryFilters,
  teams: readonly TheaterTeam[],
): InventoryItem[] {
  const text = filters.text.trim().toLowerCase()

  return items.filter((item) => {
    if (text.length > 0) {
      const haystack = [
        item.name,
        item.category,
        item.location,
        item.notes ?? '',
        teamNameOf(item, teams),
      ]
        .join(' ')
        .toLowerCase()

      if (!haystack.includes(text)) return false
    }

    if (filters.category !== 'all' && item.category !== filters.category) return false
    if (filters.teamId !== 'all' && item.team_id !== filters.teamId) return false

    if (filters.condition !== 'all') {
      const summary = conditionSummary(item.condition_counts)
      const key = summary ?? 'unclassified'
      if (key !== filters.condition) return false
    }

    if (filters.availability === 'available' && item.quantity_available <= 0) return false
    if (filters.availability === 'unavailable' && item.quantity_available > 0) return false

    return true
  })
}
