import type { Timestamp } from 'firebase/firestore'

export const MAINTENANCE_STATUSES = [
  'planned',
  'sent',
  'in_service',
  'ready',
  'returned',
  'cancelled',
] as const

export type MaintenanceStatus = (typeof MAINTENANCE_STATUSES)[number]

export const RETURN_METHODS = ['pickup', 'delivery', 'other'] as const

export type ReturnMethod = (typeof RETURN_METHODS)[number]

/**
 * Path: maintenance_records/{maintenanceId}
 *
 * `team_id` is a historical snapshot of the linked item's team at creation, and
 * is what edit scope is judged against.
 */
export interface MaintenanceRecord {
  maintenance_id: string
  organization_id: string
  item_id: string
  team_id: string

  /**
   * How the repaired equipment is counted. Absent means `bulk`, which is every
   * record written before individual tracking existed.
   *
   * A bulk repair is a quantity: four of the twenty-four clamps went out, and
   * which four was never recorded. A serialized repair names the exact pieces.
   */
  tracking_mode?: 'bulk' | 'serialized'
  /** Serialized only. Fixed when the equipment leaves; see decision 84. */
  unit_ids?: string[]

  /** Mirrors `unit_ids.length` for a serialized record. */
  quantity_sent: number
  issue_description: string
  status: MaintenanceStatus
  sent_at?: Timestamp
  return_method?: ReturnMethod
  expected_return_at?: Timestamp
  returned_at?: Timestamp
  service_provider_name?: string
  service_provider_phone?: string
  service_provider_email?: string
  cost?: number
  repair_notes?: string
  created_by_uid: string
  created_at: Timestamp
  updated_at: Timestamp
}
