import { offeredTransitions } from '@/domain/inventory'
import { isOperationallyAvailable } from '@/domain/inventory-unit'
import { canEditTeamScopedRecord } from '@/domain/module-access'
import type { EffectiveRole } from '@/domain/effective-role'
import type { OrganizationMembership } from '@/types/organization'
import { UNIT_STATUS_LABELS } from '@/features/inventory/inventory-unit-view'
import type { AssetEvent, AssetEventType } from '@/types/asset-event'
import type { InventoryUnit, UnitStatus } from '@/types/inventory'

/** Presentation for lifecycle actions and history. Pure, so the tests can hold it. */

export interface LifecycleActionOption {
  to: UnitStatus
  label: string
  /** Destructive actions get the quieter treatment; nothing here is undoable. */
  tone: 'default' | 'outline'
}

const ACTION_LABELS: Partial<Record<UnitStatus, Partial<Record<UnitStatus, string>>>> = {
  available: { in_use: 'Mark as In Use', lost: 'Mark Lost', retired: 'Retire' },
  in_use: { available: 'Check In', lost: 'Mark Lost' },
  lost: { available: 'Mark as Found', retired: 'Retire' },
}

/**
 * The buttons a unit page shows, in the order they should appear.
 *
 * Driven by the domain's offered transitions rather than a second list, so a
 * button can never appear for a move the service would refuse.
 *
 * Condition matters as well as status. An unusable unit is on the shelf and not
 * fit to take out, and `lifecycleRefusal` says so — but a button that appears
 * and then explains itself away is worse than one that was never there, so it
 * is not offered in the first place. Losing and retiring it stay available,
 * because both are things that genuinely happen to broken equipment.
 */
export function lifecycleActions(
  unit: Pick<InventoryUnit, 'status' | 'condition'>,
): LifecycleActionOption[] {
  return offeredTransitions(unit.status)
    .filter((to) => !(to === 'in_use' && !isOperationallyAvailable(unit)))
    .map((to) => ({
      to,
      label: ACTION_LABELS[unit.status]?.[to] ?? UNIT_STATUS_LABELS[to],
      tone: to === 'retired' || to === 'lost' ? 'outline' : 'default',
    }))
}

/** Why a unit offers nothing, or offers less than usual. */
export function noActionsReason(
  unit: Pick<InventoryUnit, 'status' | 'condition'>,
): string | null {
  if (unit.status === 'in_maintenance') {
    return 'This unit is away for repair. Its status follows the maintenance record.'
  }
  if (unit.status === 'retired') {
    return 'This unit has been retired. Its history stays, but it is out of the inventory.'
  }
  if (unit.status === 'available' && !isOperationallyAvailable(unit)) {
    return 'This unit is unusable, so it cannot be taken out until it is repaired.'
  }
  return null
}

/**
 * Whether the unit page shows lifecycle controls at all, and which.
 *
 * The page's whole decision in one place, so it can be tested without mounting
 * a component. Permission first: acting on a unit follows its owning team, and
 * an Admin is not held to that — `canEditTeamScopedRecord` already knows, and
 * routing the decision through it is what keeps the page from inventing a
 * second, subtly different rule.
 */
export interface LifecyclePanel {
  /** False hides the section entirely: this person cannot move this unit. */
  visible: boolean
  actions: LifecycleActionOption[]
  /** Shown when the section is visible but empty. */
  reason: string | null
}

export function lifecyclePanel(params: {
  unit: Pick<InventoryUnit, 'status' | 'condition' | 'team_id'>
  role: EffectiveRole | null
  membership: Pick<OrganizationMembership, 'team_ids' | 'permissions'> | null
}): LifecyclePanel {
  const allowed = canEditTeamScopedRecord(
    params.role, params.membership, 'inventory', params.unit.team_id,
  )

  if (!allowed) return { visible: false, actions: [], reason: null }

  const actions = lifecycleActions(params.unit)
  return {
    visible: true,
    actions,
    reason: actions.length === 0 || noActionsReason(params.unit) !== null
      ? noActionsReason(params.unit)
      : null,
  }
}

const EVENT_LABELS: Record<AssetEventType, string> = {
  marked_in_use: 'Marked as In Use',
  checked_in: 'Checked In',
  marked_lost: 'Marked Lost',
  marked_found: 'Found',
  retired: 'Retired',
}

export function eventLabel(event: Pick<AssetEvent, 'event_type'>): string {
  return EVENT_LABELS[event.event_type]
}

/**
 * The one line of detail a history entry carries, if any.
 *
 * Reads differently by direction: taking equipment out names who is getting it,
 * while handing it back or losing it names who had it — which by then the unit
 * document no longer says.
 */
export function eventDetail(
  event: Pick<AssetEvent, 'event_type' | 'using_team_id' | 'retirement_reason'>,
  teamName: (teamId: string) => string,
): string | null {
  if (event.event_type === 'retired') {
    return event.retirement_reason ? `Reason: ${RETIREMENT_LABELS[event.retirement_reason]}` : null
  }
  if (!event.using_team_id) return null

  const name = teamName(event.using_team_id)
  return event.event_type === 'marked_in_use'
    ? `Using team: ${name}`
    : `Previously used by: ${name}`
}

const RETIREMENT_LABELS: Record<string, string> = {
  disposed: 'Disposed',
  permanently_lost: 'Permanently lost',
  donated: 'Donated',
  sold: 'Sold',
  other: 'Other',
}

export function retirementLabel(reason: string): string {
  return RETIREMENT_LABELS[reason] ?? reason
}

/**
 * The controls a unit row offers in the item's equipment list.
 *
 * Discovery was the problem this answers: the asset code was a link, and a link
 * that looks like a label is not a way anybody finds. Every row now says what it
 * can do, and "View details" is spelled out rather than implied.
 *
 * `canManageStatus` reuses `lifecyclePanel`, so the list and the unit page
 * cannot disagree about who may move a unit or which moves exist.
 */
export interface UnitRowControls {
  canManageStatus: boolean
  canEdit: boolean
  /** Always offered: reading a unit follows the module, not the owning team. */
  canViewDetails: boolean
}

export function unitRowControls(params: {
  unit: Pick<InventoryUnit, 'status' | 'condition' | 'team_id'>
  role: EffectiveRole | null
  membership: Pick<OrganizationMembership, 'team_ids' | 'permissions'> | null
}): UnitRowControls {
  const panel = lifecyclePanel(params)
  const editable = canEditTeamScopedRecord(
    params.role, params.membership, 'inventory', params.unit.team_id,
  )

  return {
    // Visible only when there is actually something to do: a retired unit has
    // no moves left, and offering the control would be a dead end.
    canManageStatus: panel.visible && panel.actions.length > 0,
    canEdit: editable,
    canViewDetails: true,
  }
}
