import { calculateEstimatedCost, formatCents, isValidCostCents } from '@/domain/money'
import { countsTowardCost } from '@/domain/production-costs'
import { requirementAvailability } from '@/domain/production'
import { trackingModeOf } from '@/domain/inventory'
import type { InventoryItem } from '@/types/inventory'
import type { ActionItem, ProductionRequirement } from '@/types/production'

/**
 * What a production already plans, worked out before the model sees anything.
 *
 * Every number here is calculated by the application: how many are available,
 * what is short, what the shortage would cost at the stored estimate, how much
 * of an existing purchase is no longer needed. The model explains these facts;
 * it never derives them. A planning assistant that did its own arithmetic would
 * be confidently wrong about money in a way nobody could audit, and the whole
 * point of a budget is that somebody can check it.
 *
 * Nothing here is stored. It is assembled per request from records the user is
 * already allowed to read, and discarded with the response.
 */

export interface PlannedAction {
  /** Request-local, like the inventory references. Never a document id. */
  ref: string
  actionType: ActionItem['action_type']
  status: ActionItem['status']
  quantity: number
  estimatedUnitCostCents: number | null
  /** Quantity times the unit estimate. Derived, never stored. */
  estimatedTotalCents: number | null
}

export interface RequirementPlan {
  ref: string
  itemName: string
  requiredQty: number
  /** True when the requirement points at an inventory item that exists. */
  matched: boolean
  /** The matched item's reference in the inventory context, when it is there. */
  inventoryRef: string | null
  matchedItemName: string | null
  serialized: boolean
  /** Null when unmatched — which is not the same as zero available. */
  availableQty: number | null
  shortage: number | null
  unitCostCents: number | null
  /** What the shortage would cost at the item's stored estimate. */
  knownShortageCostCents: number | null
  action: PlannedAction | null
  /**
   * How much of an existing purchase the current inventory has made
   * unnecessary. Null when there is no action or nothing to give back.
   */
  excessQuantity: number | null
  potentialSavingsCents: number | null
}

export interface ProductionPlan {
  requirements: RequirementPlan[]
  /** Total of the savings this projection can actually prove. */
  knownPotentialSavingsCents: number
  /** Requirements whose action now plans for more than the shortage. */
  overplannedCount: number
  /** Matched requirements the inventory already covers. */
  coveredCount: number
}

/**
 * Whether an action plans for more equipment than the production still needs.
 *
 * The action quantity is a snapshot taken when somebody planned the work, and
 * decision 45 keeps it that way on purpose — it records what the crew decided,
 * not a live view of the shelf. That is exactly what makes this worth pointing
 * out: inventory arrives, the shortage falls, and the purchase order nobody
 * revisited is still for twenty.
 *
 * Cancelled work is left alone; it is already not happening.
 */
function excessOf(shortage: number, action: PlannedAction | null): number | null {
  if (!action || !countsTowardCost(action.status)) return null

  const excess = action.quantity - shortage
  return excess > 0 ? excess : null
}

export function buildProductionPlan(params: {
  requirements: readonly ProductionRequirement[]
  items: readonly InventoryItem[]
  actions: readonly ActionItem[]
  /** Item id to the reference it was given in the inventory context. */
  inventoryRefs?: ReadonlyMap<string, string>
}): ProductionPlan {
  const plans: RequirementPlan[] = []
  let knownPotentialSavingsCents = 0
  let overplannedCount = 0
  let coveredCount = 0

  params.requirements.forEach((requirement, index) => {
    const availability = requirementAvailability(requirement, params.items)
    const item = requirement.inventory_item_id
      ? params.items.find((entry) => entry.item_id === requirement.inventory_item_id) ?? null
      : null

    const found = params.actions.find(
      (entry) => entry.requirement_id === requirement.requirement_id,
    )

    const action: PlannedAction | null = found
      ? {
        ref: `A${String(index + 1)}`,
        actionType: found.action_type,
        status: found.status,
        quantity: found.quantity,
        estimatedUnitCostCents: isValidCostCents(found.estimated_unit_cost_cents)
          ? found.estimated_unit_cost_cents
          : null,
        estimatedTotalCents: calculateEstimatedCost(
          found.quantity, found.estimated_unit_cost_cents,
        ),
      }
      : null

    const shortage = availability.matched ? availability.shortage : null
    const unitCostCents = isValidCostCents(item?.unit_cost_cents) ? item.unit_cost_cents : null

    const excessQuantity = shortage === null ? null : excessOf(shortage, action)
    const potentialSavingsCents = excessQuantity === null
      ? null
      : calculateEstimatedCost(excessQuantity, action?.estimatedUnitCostCents)

    if (excessQuantity !== null) overplannedCount += 1
    if (potentialSavingsCents !== null) knownPotentialSavingsCents += potentialSavingsCents
    if (shortage === 0) coveredCount += 1

    plans.push({
      ref: `R${String(index + 1)}`,
      itemName: requirement.item_name,
      requiredQty: requirement.required_qty,
      matched: availability.matched,
      inventoryRef: item ? params.inventoryRefs?.get(item.item_id) ?? null : null,
      matchedItemName: item?.name ?? null,
      serialized: item ? trackingModeOf(item) === 'serialized' : false,
      availableQty: availability.matched ? availability.available : null,
      shortage,
      unitCostCents,
      knownShortageCostCents: shortage === null
        ? null
        : calculateEstimatedCost(shortage, unitCostCents),
      action,
      excessQuantity,
      potentialSavingsCents,
    })
  })

  return { requirements: plans, knownPotentialSavingsCents, overplannedCount, coveredCount }
}

/** One requirement, as a line the model reads. */
export function serializeRequirementPlan(plan: RequirementPlan): string {
  const parts = [plan.ref, plan.itemName, `required ${String(plan.requiredQty)}`]

  if (!plan.matched) {
    // Not matched is not zero available. The difference matters: one is a gap
    // in the plan, the other is a gap on the shelf.
    parts.push('not matched to any inventory record, so availability is unknown')
  } else {
    parts.push(
      plan.inventoryRef ? `inventory ${plan.inventoryRef}` : 'inventory not in this list',
      `available ${String(plan.availableQty ?? 0)}`,
      `shortage ${String(plan.shortage ?? 0)}`,
      plan.serialized ? 'tracked as individual units' : 'tracked as a bulk quantity',
      plan.unitCostCents === null
        ? 'stored unit cost unknown'
        : `stored unit cost ${formatCents(plan.unitCostCents)}`,
    )

    if (plan.knownShortageCostCents !== null) {
      parts.push(`known cost to cover the shortage ${formatCents(plan.knownShortageCostCents)}`)
    }
  }

  if (plan.action) {
    parts.push(
      `existing action ${plan.action.ref}`,
      `${plan.action.actionType} ${String(plan.action.quantity)}`,
      `status ${plan.action.status}`,
      plan.action.estimatedTotalCents === null
        ? 'action cost not estimated'
        : `action estimated cost ${formatCents(plan.action.estimatedTotalCents)}`,
    )
  } else {
    parts.push('no action planned yet')
  }

  if (plan.excessQuantity !== null) {
    parts.push(
      `action plans ${String(plan.excessQuantity)} more than the current shortage`,
      plan.potentialSavingsCents === null
        ? 'possible saving cannot be priced'
        : `known possible saving ${formatCents(plan.potentialSavingsCents)}`,
    )
  }

  return parts.join(' | ')
}

/** The plan block as it appears in the prompt. */
export function planBlock(plan: ProductionPlan): string {
  if (plan.requirements.length === 0) {
    return 'CURRENT PLAN: this production has no requirements yet.'
  }

  const header = `CURRENT PLAN: ${String(plan.requirements.length)} requirement(s) already recorded.`
    + ' Every quantity, shortage, and cost below was calculated by the application from current'
    + ' data. Treat them as facts and do not recompute them.'

  return [
    header,
    '<<<PLAN_DATA',
    ...plan.requirements.map(serializeRequirementPlan),
    'PLAN_DATA>>>',
  ].join('\n')
}
