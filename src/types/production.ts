import type { Timestamp } from 'firebase/firestore'

export const PRODUCTION_STATUSES = ['planning', 'active', 'completed'] as const
export type ProductionStatus = (typeof PRODUCTION_STATUSES)[number]

/** Path: productions/{productionId} — organization-level, not team-scoped. */
export interface Production {
  production_id: string
  organization_id: string
  title: string
  description?: string
  notes?: string
  start_date?: Timestamp
  end_date?: Timestamp
  status: ProductionStatus
  created_by_uid: string
  created_at: Timestamp
  updated_at: Timestamp
}

export const REQUIREMENT_SOURCES = ['manual', 'ai_approved'] as const
export type RequirementSource = (typeof REQUIREMENT_SOURCES)[number]

/** Path: production_requirements/{requirementId} — team-scoped for editing. */
export interface ProductionRequirement {
  requirement_id: string
  organization_id: string
  production_id: string
  item_name: string
  inventory_item_id?: string
  required_qty: number
  team_id: string
  notes?: string

  // No action_type here. The plan lives on the Action Item, which is the single
  // persisted source of truth for it; storing a second copy would let the two
  // disagree. Already Available is derived from a shortage of zero and is never
  // stored at all.
  source: RequirementSource
  created_by_uid: string
  created_at: Timestamp
  updated_at: Timestamp
}

export const ACTION_TYPES = ['buy', 'rent', 'build', 'repair'] as const
export type ActionType = (typeof ACTION_TYPES)[number]

export const ACTION_STATUSES = ['todo', 'in_progress', 'done', 'cancelled'] as const
export type ActionStatus = (typeof ACTION_STATUSES)[number]

/**
 * Path: action_items/{requirementId}
 *
 * The document ID is the requirement ID, which is what structurally allows at
 * most one Action Item per requirement.
 */
export interface ActionItem {
  action_item_id: string
  organization_id: string
  production_id: string
  requirement_id: string
  item_name: string
  action_type: ActionType
  quantity: number
  /**
   * Planning estimate for one unit, in cents. Absent means nobody has estimated
   * it, which is deliberately not the same as zero — the production summary
   * reports it as missing rather than adding nothing and calling the total
   * complete. The line total is `quantity` times this, derived and never stored.
   */
  estimated_unit_cost_cents?: number
  team_id: string
  assignee_uid?: string
  due_date?: Timestamp
  status: ActionStatus
  notes?: string
  created_by_uid: string
  created_at: Timestamp
  updated_at: Timestamp
}
