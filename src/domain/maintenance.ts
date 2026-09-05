import {
  MAINTENANCE_STATUSES,
  type MaintenanceRecord,
  type MaintenanceStatus,
} from '@/types/maintenance'
import type { UnitStatus } from '@/types/inventory'

/**
 * Maintenance arithmetic, kept out of components so the list, the detail, and
 * the inventory summary all agree on what "in service" means.
 */

export const MAINTENANCE_STATUS_LABELS: Record<MaintenanceStatus, string> = {
  planned: 'Planned',
  sent: 'Sent',
  in_service: 'In Service',
  ready: 'Ready for Pickup',
  returned: 'Returned',
  cancelled: 'Cancelled',
}

/**
 * Statuses that count toward the in-service quantity: the equipment has left
 * and has not come back. `planned` has not gone yet; `returned` and `cancelled`
 * are finished.
 */
export const ACTIVE_STATUSES: readonly MaintenanceStatus[] = ['sent', 'in_service', 'ready']

/**
 * The lifecycle status a bulk item should carry, given every repair filed
 * against it.
 *
 * Bulk equipment has no units to move, so the item itself is what goes to the
 * shop — and unlike a unit, it can be on several repairs at once. It is away
 * while *any* of them is active, and back only when the last one closes. That
 * is why this takes the whole set rather than the record being written: a
 * record returning tells you nothing on its own if two others are still out.
 *
 * Returns `null` when the item's status should not move. Maintenance only ever
 * swaps `available` and `in_maintenance`, the same pair `isMaintenanceMove`
 * allows for a unit — equipment that is signed out or lost is not at a repair
 * shop, and a repair opened against it leaves its status alone rather than
 * overwriting where it actually is.
 */
export function bulkMaintenanceStatusFor(
  currentItemStatus: UnitStatus,
  records: readonly Pick<MaintenanceRecord, 'status'>[],
): UnitStatus | null {
  const away = records.some((record) => isActiveStatus(record.status))

  if (away && currentItemStatus === 'available') return 'in_maintenance'
  if (!away && currentItemStatus === 'in_maintenance') return 'available'
  return null
}

export function isActiveStatus(status: MaintenanceStatus): boolean {
  return ACTIVE_STATUSES.includes(status)
}

/**
 * Statuses that finish a repair. Everything else is still open.
 *
 * This is a different question from `ACTIVE_STATUSES` and both are needed. That
 * one asks how much equipment is physically away right now, which `planned`
 * is not. This one asks whether a repair is unfinished, which `planned` very
 * much is — it is a commitment somebody made and has not yet closed.
 *
 * Defined as the complement so a status added later blocks by default rather
 * than silently slipping through as finished.
 */
export const CLOSED_STATUSES: readonly MaintenanceStatus[] = ['returned', 'cancelled']

export function isOpenStatus(status: MaintenanceStatus): boolean {
  return !CLOSED_STATUSES.includes(status)
}

/** Repairs that have not been closed out, whether or not they have left yet. */
export function openRecords<T extends Pick<MaintenanceRecord, 'status'>>(
  records: readonly T[],
): T[] {
  return records.filter((record) => isOpenStatus(record.status))
}

export function isMaintenanceStatus(value: string): value is MaintenanceStatus {
  return (MAINTENANCE_STATUSES as readonly string[]).includes(value)
}

/** Sum of quantity sent across records that are currently out. */
export function currentlyInService(
  records: readonly Pick<MaintenanceRecord, 'status' | 'quantity_sent'>[],
): number {
  return records
    .filter((record) => isActiveStatus(record.status))
    .reduce((sum, record) => sum + record.quantity_sent, 0)
}

/**
 * A record is overdue when the date it was expected back has passed and it is
 * neither returned nor cancelled.
 */
export function isOverdue(
  record: Pick<MaintenanceRecord, 'status' | 'expected_return_at'>,
  now: Date,
): boolean {
  if (!record.expected_return_at) return false
  if (!isOpenStatus(record.status)) return false

  return record.expected_return_at.toDate().getTime() < now.getTime()
}

export type QuantityValidation = { valid: true } | { valid: false; message: string }

/**
 * Per-record validation, mirroring what Security Rules enforce. Checking it here
 * turns a permission-denied into a sentence the user can act on.
 */
export function validateQuantitySent(params: {
  quantitySent: number
  itemQuantityTotal: number
}): QuantityValidation {
  if (!Number.isInteger(params.quantitySent) || params.quantitySent <= 0) {
    return { valid: false, message: 'Quantity sent must be a whole number greater than zero.' }
  }

  if (params.quantitySent > params.itemQuantityTotal) {
    return {
      valid: false,
      message: `Quantity sent cannot exceed the item's total of ${params.itemQuantityTotal}.`,
    }
  }

  return { valid: true }
}

export interface OverCapacityWarning {
  inService: number
  quantityTotal: number
  message: string
}

/**
 * Whether a write would put more units in service than the item has.
 *
 * This is a **warning, not an invariant**. Security Rules have no query
 * capability, so an aggregate across sibling documents cannot be enforced
 * there; a block that lived only here would look like a boundary without being
 * one. It is also not always an error — reducing `quantity_total` after
 * scrapping equipment can produce it from correct data.
 *
 * `editingRecordId` excludes the record being edited from the existing total,
 * so its own quantity is not counted twice.
 */
export function overCapacityWarning(params: {
  existingRecords: readonly Pick<MaintenanceRecord, 'maintenance_id' | 'status' | 'quantity_sent'>[]
  editingRecordId?: string | undefined
  status: MaintenanceStatus
  quantitySent: number
  itemQuantityTotal: number
}): OverCapacityWarning | null {
  const others = params.existingRecords.filter(
    (record) => record.maintenance_id !== params.editingRecordId,
  )

  const proposed = isActiveStatus(params.status) ? params.quantitySent : 0
  const inService = currentlyInService(others) + proposed

  if (inService <= params.itemQuantityTotal) return null

  return {
    inService,
    quantityTotal: params.itemQuantityTotal,
    message: `This would put ${inService} of ${params.itemQuantityTotal} units in service. Check the maintenance quantities or the item's current total.`,
  }
}
