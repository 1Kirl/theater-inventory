import { offeredTransitions } from '@/domain/inventory'
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
 */
export function lifecycleActions(unit: Pick<InventoryUnit, 'status'>): LifecycleActionOption[] {
  return offeredTransitions(unit.status).map((to) => ({
    to,
    label: ACTION_LABELS[unit.status]?.[to] ?? UNIT_STATUS_LABELS[to],
    tone: to === 'retired' || to === 'lost' ? 'outline' : 'default',
  }))
}

/** Why a unit offers nothing, when it offers nothing. */
export function noActionsReason(unit: Pick<InventoryUnit, 'status'>): string | null {
  if (unit.status === 'in_maintenance') {
    return 'This unit is away for repair. Its status follows the maintenance record.'
  }
  if (unit.status === 'retired') {
    return 'This unit has been retired. Its history stays, but it is out of the inventory.'
  }
  return null
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
