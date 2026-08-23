import type { Timestamp } from 'firebase/firestore'

export type ConditionKey = 'excellent' | 'good' | 'fair' | 'needs_repair' | 'unusable'

export type ConditionCounts = Record<ConditionKey, number>

/**
 * Categories from PROJECT_SPEC section 7.4. A fixed list rather than free text,
 * so the category filter has something stable to offer.
 */
export const INVENTORY_CATEGORIES = [
  'Lighting Instruments',
  'Cables',
  'Lighting Accessories',
  'Sound Equipment',
  'Microphones',
  'Tools',
  'Set-Building Materials',
  'Platforms / Flats',
  'Props',
  'Costumes',
  'Hardware',
  'Miscellaneous Technical Equipment',
] as const

export type InventoryCategory = (typeof INVENTORY_CATEGORIES)[number]

/**
 * Path: inventory_items/{itemId}
 *
 * Team-scoped for editing, organization-wide for reading. `team_id` is required:
 * an item nobody owns is an item only the Admin could maintain.
 */
export interface InventoryItem {
  item_id: string
  organization_id: string
  name: string
  category: string
  team_id: string
  quantity_total: number
  quantity_available: number
  condition_counts: ConditionCounts
  location: string
  last_inspected_at?: Timestamp
  notes?: string
  created_by_uid: string
  created_at: Timestamp
  updated_at: Timestamp
}
