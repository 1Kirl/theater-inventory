import { calculateEstimatedCost, formatCents } from '@/domain/money'
import { ACTION_TYPES, type ActionItem, type ActionStatus, type ActionType } from '@/types/production'

/**
 * What a production is expected to cost, counted from its action items.
 *
 * Derived on every read and never stored. A persisted total would be a second
 * copy of the same fact, and the two would disagree the first time somebody
 * edited an action from another screen — which is the same reason shortage,
 * condition summaries, and dashboard counts are all computed rather than saved.
 *
 * Cancelled work is excluded and completed work is not. A production that has
 * already bought the cable still had to pay for it, and dropping done actions
 * from the estimate would make the number shrink as the season progressed,
 * which is the opposite of what a budget is for. Cancelled work, by contrast,
 * was decided against and never cost anything.
 */
export const COUNTED_ACTION_STATUSES: readonly ActionStatus[] = ['todo', 'in_progress', 'done']

export function countsTowardCost(status: ActionStatus): boolean {
  return COUNTED_ACTION_STATUSES.includes(status)
}

export interface ProductionCostSummary {
  /** Cents, summed from the actions that carry an estimate. */
  knownTotalCents: number
  /** The same total, split by what kind of work it is. */
  byType: Record<ActionType, number>
  /** Counted actions that carry an estimate. */
  estimatedCount: number
  /**
   * Counted actions with no estimate. The whole reason this is reported rather
   * than folded into the total: an unknown cost is not a zero cost, and a total
   * that hides three of them is a number somebody will plan against and be
   * wrong.
   */
  missingCount: number
}

const EMPTY_BY_TYPE: Record<ActionType, number> = {
  buy: 0, rent: 0, build: 0, repair: 0,
}

export function summarizeProductionCosts(
  actions: readonly ActionItem[],
): ProductionCostSummary {
  const byType: Record<ActionType, number> = { ...EMPTY_BY_TYPE }
  let knownTotalCents = 0
  let estimatedCount = 0
  let missingCount = 0

  for (const action of actions) {
    if (!countsTowardCost(action.status)) continue

    const cost = calculateEstimatedCost(action.quantity, action.estimated_unit_cost_cents)
    if (cost === null) {
      missingCount += 1
      continue
    }

    // Exactly one bucket per action, so the parts always add to the whole.
    byType[action.action_type] += cost
    knownTotalCents += cost
    estimatedCount += 1
  }

  return { knownTotalCents, byType, estimatedCount, missingCount }
}

/** True when the headline total is the whole story. */
export function isCostEstimateComplete(summary: ProductionCostSummary): boolean {
  return summary.missingCount === 0
}

/** Says plainly what the total leaves out, or nothing when it leaves out nothing. */
export function missingCostNote(summary: ProductionCostSummary): string | null {
  if (summary.missingCount === 0) return null

  return summary.missingCount === 1
    ? '1 action item has no cost estimate, so it is not included.'
    : `${String(summary.missingCount)} action items have no cost estimate, `
      + 'so they are not included.'
}

/** The breakdown rows, in a fixed order so the panel does not reshuffle. */
export function costBreakdown(
  summary: ProductionCostSummary,
): { type: ActionType; cents: number }[] {
  return ACTION_TYPES.map((type) => ({ type, cents: summary.byType[type] }))
}

/**
 * Whether a suggested inventory price means anything for this kind of work.
 *
 * Only for buying. The shelf price of a microphone is what restocking costs, so
 * suggesting it for a Buy saves typing and is usually right. It says nothing
 * about a week's rental, the lumber for a build, or what a shop will charge to
 * fix one — guessing there would put a confident wrong number in a budget,
 * which is worse than an empty field somebody has to fill in.
 */
export function actionTypeTakesPrefill(actionType: ActionType): boolean {
  return actionType === 'buy'
}

/**
 * One action's estimated line cost, for a list where a column of dashes would
 * be worse than a column that says what it means.
 */
export function actionEstimateLabel(action: Pick<ActionItem, 'quantity' | 'estimated_unit_cost_cents'>): string {
  const cost = calculateEstimatedCost(action.quantity, action.estimated_unit_cost_cents)
  return cost === null ? 'Not estimated' : formatCents(cost)
}
