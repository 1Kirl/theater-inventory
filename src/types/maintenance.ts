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
