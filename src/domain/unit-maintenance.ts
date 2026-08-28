import { isSerialized } from '@/domain/inventory'
import { MAX_BULK_UNITS } from '@/domain/inventory-unit'
import type { InventoryItem, InventoryUnit } from '@/types/inventory'
import type { MaintenanceRecord, MaintenanceStatus } from '@/types/maintenance'

/**
 * Sending individually tracked equipment for repair.
 *
 * A bulk repair records a quantity — four of the twenty-four clamps went out,
 * and which four was never written down. A serialized repair names the exact
 * pieces, so the equipment can be followed and each unit can answer what has
 * been done to it.
 */

/** How many units one repair may take, matching the measured Rules ceiling. */
export const MAX_UNITS_PER_MAINTENANCE = MAX_BULK_UNITS

export function maintenanceTrackingModeOf(
  record: Pick<MaintenanceRecord, 'tracking_mode'>,
): 'bulk' | 'serialized' {
  return record.tracking_mode ?? 'bulk'
}

export function isSerializedMaintenance(
  record: Pick<MaintenanceRecord, 'tracking_mode'>,
): boolean {
  return maintenanceTrackingModeOf(record) === 'serialized'
}

/**
 * Whether a unit can be sent for repair.
 *
 * Only from the shelf. Equipment that is out has to come back first, something
 * lost has to be found first, and a unit already at the shop is already there —
 * each of those is a lifecycle move with its own record, and letting a repair
 * perform it silently would be a shortcut around the history.
 *
 * Condition is deliberately not a factor. A clamp in perfect condition can go
 * for a service, and one marked unusable is exactly what a repair is for.
 */
export function canSendToMaintenance(
  unit: Pick<InventoryUnit, 'status'>,
): boolean {
  return unit.status === 'available'
}

/**
 * Whether a unit may be written into a plan.
 *
 * Wider than what may actually be sent, because a plan is about next week. A
 * microphone somebody is using today is a perfectly reasonable thing to plan a
 * repair for — it can be checked in first. What cannot be planned for is
 * equipment nobody can find, equipment already at another shop, and equipment
 * that has left the inventory for good.
 *
 * A unit already in an open plan is excluded too: one plan at a time keeps a
 * teacher from accidentally scheduling the same microphone twice.
 */
export function canPlanForMaintenance(
  unit: Pick<InventoryUnit, 'status' | 'planned_maintenance_record_id'>,
  /** The plan being edited, whose own units are of course still eligible. */
  planId?: string,
): boolean {
  if (!['available', 'in_use'].includes(unit.status)) return false

  const planned = unit.planned_maintenance_record_id
  return !planned || planned === planId
}

export function planIneligibleReason(
  unit: Pick<InventoryUnit, 'status' | 'planned_maintenance_record_id'>,
  planId?: string,
): string | null {
  if (canPlanForMaintenance(unit, planId)) return null
  if (unit.status === 'lost') return 'Missing — find it before planning a repair'
  if (unit.status === 'in_maintenance') return 'Already at the repair shop'
  if (unit.status === 'retired') return 'Retired'
  return 'Already planned for another repair'
}

export interface StartConflict {
  assetCode: string
  reason: string
}

/**
 * Why a planned repair cannot start yet.
 *
 * Checked at the moment of starting rather than held in reserve beforehand,
 * which is what lets the equipment stay usable while the plan waits. Every unit
 * has to be on the shelf, because a repair takes all of its equipment at once
 * or none of it.
 */
export function startConflicts(units: readonly InventoryUnit[]): StartConflict[] {
  return units
    .filter((unit) => !canSendToMaintenance(unit))
    .map((unit) => ({
      assetCode: unit.asset_code,
      reason: ineligibleReason(unit) ?? 'Not available',
    }))
}

export function describeStartConflicts(conflicts: readonly StartConflict[]): string {
  if (conflicts.length === 0) return ''

  const listed = conflicts.map((one) => `${one.assetCode} — ${one.reason}`).join(', ')
  return `${conflicts.length} planned unit${conflicts.length === 1 ? ' is' : 's are'} not `
    + `currently available: ${listed}. Check them in, resolve their status, or update the `
    + 'planned equipment before starting this repair.'
}

export function ineligibleReason(unit: Pick<InventoryUnit, 'status'>): string | null {
  if (unit.status === 'available') return null
  if (unit.status === 'in_use') return 'Out with a crew — check it in first'
  if (unit.status === 'lost') return 'Missing — mark it found first'
  if (unit.status === 'in_maintenance') return 'Already at the repair shop'
  return 'Retired'
}

export type MaintenanceSelection =
  | { valid: true; unitIds: string[] }
  | { valid: false; message: string }

/**
 * What must hold before a serialized repair can be created.
 *
 * `teamIds` are the crews this person may act for. Every selected unit is
 * checked against them because the batch is atomic: one unit the actor cannot
 * move fails the whole write, and a selection that would fail is better refused
 * here with an explanation than by Security Rules without one.
 */
export function validateMaintenanceSelection(params: {
  item: Pick<InventoryItem, 'tracking_mode'>
  units: readonly InventoryUnit[]
  selectedIds: readonly string[]
  teamIds: readonly string[]
}): MaintenanceSelection {
  if (!isSerialized(params.item)) {
    return { valid: false, message: 'This item tracks a quantity rather than individual pieces.' }
  }

  if (params.selectedIds.length === 0) {
    return { valid: false, message: 'Choose the equipment to send.' }
  }

  if (new Set(params.selectedIds).size !== params.selectedIds.length) {
    return { valid: false, message: 'The same unit was chosen twice.' }
  }

  if (params.selectedIds.length > MAX_UNITS_PER_MAINTENANCE) {
    return {
      valid: false,
      message: `Send at most ${MAX_UNITS_PER_MAINTENANCE} pieces at a time. `
        + 'Split a larger repair into separate records.',
    }
  }

  for (const id of params.selectedIds) {
    const unit = params.units.find((one) => one.unit_id === id)
    if (!unit) return { valid: false, message: 'One of the chosen units no longer exists.' }

    if (!canSendToMaintenance(unit)) {
      return {
        valid: false,
        message: `${unit.asset_code} cannot be sent: ${
          (ineligibleReason(unit) ?? '').toLowerCase()}.`,
      }
    }

    if (!params.teamIds.includes(unit.team_id)) {
      return {
        valid: false,
        message: `${unit.asset_code} belongs to a crew you cannot manage.`,
      }
    }
  }

  return { valid: true, unitIds: [...params.selectedIds] }
}

/**
 * The statuses a serialized repair may hold.
 *
 * `planned` is missing on purpose. A serialized repair exists because the
 * equipment left, so there is no stage where a selection sits reserved — which
 * is what would otherwise let two repairs claim the same clamp. Bulk repairs
 * keep `planned`, because a bulk quantity is not taken from anywhere until it
 * goes.
 */
export const SERIALIZED_MAINTENANCE_STATUSES: readonly MaintenanceStatus[] = [
  'sent', 'in_service', 'ready', 'returned', 'cancelled',
]

/**
 * Where a serialized repair may be recorded as starting.
 *
 * Recording a repair is not the same as starting one. Microphones sent on
 * Monday might not be entered until Wednesday, by which time the shop is
 * already working on them — and making the teacher file it as Sent and then
 * click through to In Service would be asking them to type a fiction and then
 * correct it.
 *
 * So any stage where the equipment is away can be the one it is first written
 * down at. What none of them can be is `planned` (the equipment has gone) or
 * `returned`/`cancelled` (a repair that is over has nothing to record).
 *
 * The unit lifecycle does not care which: all three mean the same thing to a
 * clamp, which is that it is at the repair shop.
 */
export const SERIALIZED_CREATE_STATUSES: readonly MaintenanceStatus[] = [
  'planned', 'sent', 'in_service', 'ready',
]

/** Stages where the equipment has physically left. */
export const SERIALIZED_ACTIVE_STATUSES: readonly MaintenanceStatus[] = [
  'sent', 'in_service', 'ready',
]

/**
 * A repair that is only intended.
 *
 * `planned` is not a lifecycle state and not a reservation. The equipment stays
 * exactly where it is and may be used, checked out, or even lost while a plan
 * sits against it — availability is checked again at the moment the repair
 * actually starts, which is the only moment the two state systems meet.
 */
export function isPlannedMaintenance(
  record: Pick<MaintenanceRecord, 'status' | 'tracking_mode'>,
): boolean {
  return isSerializedMaintenance(record) && record.status === 'planned'
}

/** Whether a repair currently holds the equipment. */
export function isActiveMaintenance(
  record: Pick<MaintenanceRecord, 'status'>,
): boolean {
  return SERIALIZED_ACTIVE_STATUSES.includes(record.status)
}

export function canCreateSerializedAt(status: MaintenanceStatus): boolean {
  return SERIALIZED_CREATE_STATUSES.includes(status)
}

/** Whether starting a plan at this stage is meaningful. */
export function canStartPlanAt(status: MaintenanceStatus): boolean {
  return SERIALIZED_ACTIVE_STATUSES.includes(status)
}

/** The moves that bring the equipment home. */
export function isMaintenanceClosing(
  from: MaintenanceStatus,
  to: MaintenanceStatus,
): boolean {
  return ['sent', 'in_service', 'ready'].includes(from)
    && (to === 'returned' || to === 'cancelled')
}

/** Whether a serialized repair still has the equipment. */
export function holdsEquipment(record: Pick<MaintenanceRecord, 'status'>): boolean {
  return ['sent', 'in_service', 'ready'].includes(record.status)
}

export type MaintenanceStatusChange =
  | { valid: true; closing: boolean }
  | { valid: false; message: string }

export function validateSerializedStatusChange(params: {
  from: MaintenanceStatus
  to: MaintenanceStatus
}): MaintenanceStatusChange {
  if (params.from === params.to) {
    return { valid: false, message: 'That is already this repair\'s status.' }
  }
  if (!SERIALIZED_MAINTENANCE_STATUSES.includes(params.to)) {
    return { valid: false, message: 'A repair on individual equipment cannot be planned.' }
  }
  if (params.from === 'returned' || params.from === 'cancelled') {
    return { valid: false, message: 'This repair is finished. Send the equipment again instead.' }
  }

  // A plan becomes real at whichever stage the repair has actually reached, or
  // is called off. Cancelling a plan moves no equipment, because none left.
  if (params.from === 'planned') {
    if (params.to === 'cancelled') return { valid: true, closing: false }
    return SERIALIZED_ACTIVE_STATUSES.includes(params.to)
      ? { valid: true, closing: false }
      : { valid: false, message: 'A plan starts as sent, in service, or ready.' }
  }

  const order: MaintenanceStatus[] = ['sent', 'in_service', 'ready']
  const closing = isMaintenanceClosing(params.from, params.to)
  if (closing) return { valid: true, closing: true }

  const fromIndex = order.indexOf(params.from)
  const toIndex = order.indexOf(params.to)
  if (fromIndex === -1 || toIndex === -1 || toIndex <= fromIndex) {
    return { valid: false, message: 'A repair moves forward: sent, in service, ready.' }
  }

  return { valid: true, closing: false }
}


export interface MaintenanceWorkflowStep {
  to: MaintenanceStatus
  label: string
  /** Ending a repair brings equipment home; the quieter treatment suits it. */
  tone: 'default' | 'outline'
}

const STEP_LABELS: Partial<Record<MaintenanceStatus, string>> = {
  sent: 'Start repair',
  in_service: 'Mark in service',
  ready: 'Mark ready for pickup',
  returned: 'Return the equipment',
  cancelled: 'Cancel this repair',
}

/**
 * What can be done to a serialized repair from where it is now.
 *
 * Strictly forward, plus cancellation. A repair does not go back to sent once
 * the shop has it, and one that is over is over — reopening would leave the
 * equipment's own history saying something different.
 *
 * The list, the detail page, and any edit form all read this, so a control
 * offered in one place cannot be missing or different in another.
 */
export function maintenanceWorkflowSteps(
  record: Pick<MaintenanceRecord, 'status' | 'tracking_mode'>,
): MaintenanceWorkflowStep[] {
  if (!isSerializedMaintenance(record)) return []

  const forward: Partial<Record<MaintenanceStatus, MaintenanceStatus[]>> = {
    // A plan starts or it is called off. Which stage it starts at is a separate
    // choice, offered where the repair is started rather than as three buttons.
    planned: ['sent', 'cancelled'],
    sent: ['in_service', 'cancelled'],
    in_service: ['ready', 'cancelled'],
    ready: ['returned', 'cancelled'],
  }

  return (forward[record.status] ?? [])
    .filter((to) => validateSerializedStatusChange({ from: record.status, to }).valid)
    .map((to) => ({
      to,
      label: STEP_LABELS[to] ?? to,
      tone: to === 'cancelled' ? ('outline' as const) : ('default' as const),
    }))
}

/** A repair with nothing left to do: the equipment is back. */
export function isMaintenanceFinished(
  record: Pick<MaintenanceRecord, 'status'>,
): boolean {
  return record.status === 'returned' || record.status === 'cancelled'
}
