import {
  ACTION_STATUS_LABELS, ACTION_TYPE_LABELS, ALREADY_AVAILABLE_LABEL, isOpenAction,
  requirementAvailability,
} from '@/domain/production'
import type { RequirementAvailability } from '@/domain/production'
import type { InventoryItem } from '@/types/inventory'
import type { ActionItem, Production, ProductionRequirement } from '@/types/production'
import type { TheaterTeam } from '@/types/organization'

/** Presentation helpers, pure so the detail table and the action list agree. */

export const NOT_MATCHED = 'Not Matched'

export function availabilityLabel(availability: RequirementAvailability): string {
  return availability.matched ? String(availability.available) : NOT_MATCHED
}

export function shortageLabel(availability: RequirementAvailability): string {
  return availability.matched ? String(availability.shortage) : NOT_MATCHED
}

/** What the Action column says when no Action Item exists yet. */
export function actionPlaceholder(availability: RequirementAvailability): string {
  if (!availability.matched) return '—'
  if (availability.alreadyAvailable) return ALREADY_AVAILABLE_LABEL
  return 'No action yet'
}

export function actionSummary(action: ActionItem): string {
  return `${ACTION_TYPE_LABELS[action.action_type]} ${action.quantity}`
}

export function teamNameById(teamId: string, teams: readonly TheaterTeam[]): string {
  return teams.find((team) => team.team_id === teamId)?.name ?? 'Unknown team'
}

export function matchedItemName(
  requirement: Pick<ProductionRequirement, 'inventory_item_id'>,
  items: readonly InventoryItem[],
): string {
  if (!requirement.inventory_item_id) return NOT_MATCHED
  return items.find((item) => item.item_id === requirement.inventory_item_id)?.name ?? NOT_MATCHED
}

export interface RequirementRow {
  requirement: ProductionRequirement
  availability: RequirementAvailability
  action: ActionItem | null
  teamName: string
  matchedName: string
}

export function buildRequirementRows(params: {
  requirements: readonly ProductionRequirement[]
  items: readonly InventoryItem[]
  actions: readonly ActionItem[]
  teams: readonly TheaterTeam[]
}): RequirementRow[] {
  return params.requirements.map((requirement) => ({
    requirement,
    availability: requirementAvailability(requirement, params.items),
    action: params.actions.find((entry) => entry.requirement_id === requirement.requirement_id) ?? null,
    teamName: teamNameById(requirement.team_id, params.teams),
    matchedName: matchedItemName(requirement, params.items),
  }))
}

export interface ProductionSummary {
  requirementCount: number
  shortageCount: number
  openActionCount: number
}

/** Counts are derived per read, never stored on the production. */
export function summarizeProduction(rows: readonly RequirementRow[]): ProductionSummary {
  return {
    requirementCount: rows.length,
    shortageCount: rows.filter((row) => row.availability.matched && row.availability.shortage > 0).length,
    openActionCount: rows.filter((row) => row.action !== null && isOpenAction(row.action.status)).length,
  }
}

export interface ActionFilters {
  text: string
  productionId: string
  teamId: string
  actionType: string
  status: string
}

export const EMPTY_ACTION_FILTERS: ActionFilters = {
  text: '',
  productionId: 'all',
  teamId: 'all',
  actionType: 'all',
  status: 'all',
}

export function filterActionItems(
  actions: readonly ActionItem[],
  filters: ActionFilters,
  context: { productions: readonly Production[]; teams: readonly TheaterTeam[] },
): ActionItem[] {
  const text = filters.text.trim().toLowerCase()

  return actions.filter((action) => {
    if (text.length > 0) {
      const production = context.productions.find((entry) => entry.production_id === action.production_id)
      const haystack = [
        action.item_name,
        production?.title ?? '',
        teamNameById(action.team_id, context.teams),
        ACTION_TYPE_LABELS[action.action_type],
        ACTION_STATUS_LABELS[action.status],
        action.notes ?? '',
      ].join(' ').toLowerCase()

      if (!haystack.includes(text)) return false
    }

    if (filters.productionId !== 'all' && action.production_id !== filters.productionId) return false
    if (filters.teamId !== 'all' && action.team_id !== filters.teamId) return false
    if (filters.actionType !== 'all' && action.action_type !== filters.actionType) return false

    if (filters.status === 'open' && !isOpenAction(action.status)) return false
    if (filters.status !== 'all' && filters.status !== 'open' && action.status !== filters.status) return false

    return true
  })
}
