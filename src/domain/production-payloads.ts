import type { FieldValue, Timestamp } from 'firebase/firestore'
import type {
  ActionStatus, ActionType, ProductionStatus, RequirementSource,
} from '@/types/production'
import { isValidCostCents } from '@/domain/money'

/**
 * The exact document shapes written to Firestore for Phase 5.
 *
 * Security Rules validate them with `hasExactly`, so an extra or missing field
 * is a permission-denied rather than a soft failure. Keeping the shapes here
 * lets the Rules tests exercise the payloads the application actually sends.
 */
export type Now = () => FieldValue

function optionalText(value: string | undefined) {
  const trimmed = value?.trim()
  return trimmed && trimmed.length > 0 ? trimmed : undefined
}

export interface ProductionInput {
  title: string
  description?: string | undefined
  notes?: string | undefined
  startDate?: Timestamp | null
  endDate?: Timestamp | null
  status: ProductionStatus
}

function productionFields(input: ProductionInput) {
  const description = optionalText(input.description)
  const notes = optionalText(input.notes)

  return {
    title: input.title.trim(),
    ...(description ? { description } : {}),
    ...(notes ? { notes } : {}),
    ...(input.startDate ? { start_date: input.startDate } : {}),
    ...(input.endDate ? { end_date: input.endDate } : {}),
    status: input.status,
  }
}

export function buildProductionDocument(params: {
  productionId: string
  organizationId: string
  uid: string
  now: Now
  input: ProductionInput
}) {
  return {
    production_id: params.productionId,
    organization_id: params.organizationId,
    ...productionFields(params.input),
    created_by_uid: params.uid,
    created_at: params.now(),
    updated_at: params.now(),
  }
}

export function buildProductionUpdate(params: {
  productionId: string
  organizationId: string
  createdByUid: string
  createdAt: Timestamp
  now: Now
  input: ProductionInput
}) {
  return {
    production_id: params.productionId,
    organization_id: params.organizationId,
    ...productionFields(params.input),
    created_by_uid: params.createdByUid,
    created_at: params.createdAt,
    updated_at: params.now(),
  }
}

export interface RequirementInput {
  itemName: string
  /** The matched inventory item, if any. Its team is unrelated to `teamId`. */
  inventoryItemId?: string | null
  requiredQty: number
  teamId: string
  notes?: string | undefined
}

function requirementFields(input: RequirementInput) {
  const notes = optionalText(input.notes)

  return {
    item_name: input.itemName.trim(),
    ...(input.inventoryItemId ? { inventory_item_id: input.inventoryItemId } : {}),
    required_qty: input.requiredQty,
    team_id: input.teamId,
    ...(notes ? { notes } : {}),
  }
}

export function buildRequirementDocument(params: {
  requirementId: string
  organizationId: string
  productionId: string
  uid: string
  now: Now
  input: RequirementInput
  /**
   * `ai_approved` records that a person reviewed and approved an AI suggestion.
   * It is not a claim that the AI wrote anything: an unapproved suggestion is
   * never sent here at all.
   */
  source?: RequirementSource
}) {
  return {
    requirement_id: params.requirementId,
    organization_id: params.organizationId,
    production_id: params.productionId,
    ...requirementFields(params.input),
    source: params.source ?? ('manual' as const),
    created_by_uid: params.uid,
    created_at: params.now(),
    updated_at: params.now(),
  }
}

export function buildRequirementUpdate(params: {
  requirementId: string
  organizationId: string
  productionId: string
  source: RequirementSource
  createdByUid: string
  createdAt: Timestamp
  now: Now
  input: RequirementInput
}) {
  return {
    requirement_id: params.requirementId,
    organization_id: params.organizationId,
    production_id: params.productionId,
    ...requirementFields(params.input),
    source: params.source,
    created_by_uid: params.createdByUid,
    created_at: params.createdAt,
    updated_at: params.now(),
  }
}

export interface ActionItemInput {
  actionType: ActionType
  quantity: number
  /** Cents per unit, or null/undefined for not estimated. */
  estimatedUnitCostCents?: number | null
  status: ActionStatus
  assigneeUid?: string | null
  dueDate?: Timestamp | null
  notes?: string | undefined
}

function actionFields(input: ActionItemInput) {
  const notes = optionalText(input.notes)

  return {
    action_type: input.actionType,
    quantity: input.quantity,
    // Presence, not truthiness: an action estimated at zero is a decision, and
    // an action nobody has priced is an open question.
    ...(isValidCostCents(input.estimatedUnitCostCents)
      ? { estimated_unit_cost_cents: input.estimatedUnitCostCents }
      : {}),
    status: input.status,
    ...(input.assigneeUid ? { assignee_uid: input.assigneeUid } : {}),
    ...(input.dueDate ? { due_date: input.dueDate } : {}),
    ...(notes ? { notes } : {}),
  }
}

/**
 * The document ID is the requirement ID, which is what makes a second Action
 * Item for the same requirement impossible. The team is copied from the
 * requirement and Rules verify the copy matches.
 */
export function buildActionItemDocument(params: {
  requirementId: string
  organizationId: string
  productionId: string
  itemName: string
  teamId: string
  uid: string
  now: Now
  input: ActionItemInput
}) {
  return {
    action_item_id: params.requirementId,
    organization_id: params.organizationId,
    production_id: params.productionId,
    requirement_id: params.requirementId,
    item_name: params.itemName,
    team_id: params.teamId,
    ...actionFields(params.input),
    created_by_uid: params.uid,
    created_at: params.now(),
    updated_at: params.now(),
  }
}

export function buildActionItemUpdate(params: {
  requirementId: string
  organizationId: string
  productionId: string
  itemName: string
  teamId: string
  createdByUid: string
  createdAt: Timestamp
  now: Now
  input: ActionItemInput
}) {
  return {
    action_item_id: params.requirementId,
    organization_id: params.organizationId,
    production_id: params.productionId,
    requirement_id: params.requirementId,
    item_name: params.itemName,
    team_id: params.teamId,
    ...actionFields(params.input),
    created_by_uid: params.createdByUid,
    created_at: params.createdAt,
    updated_at: params.now(),
  }
}
