import type { ConditionCounts, ConditionKey } from '@/types/inventory'

/**
 * Inventory arithmetic, kept out of components so it can be tested directly and
 * so the interface and Security Rules agree on what a valid item looks like.
 */

/** Worst first. The summary is the worst state holding at least one unit. */
export const CONDITION_KEYS: readonly ConditionKey[] = [
  'unusable',
  'needs_repair',
  'fair',
  'good',
  'excellent',
]

export const CONDITION_LABELS: Record<ConditionKey, string> = {
  excellent: 'Excellent',
  good: 'Good',
  fair: 'Fair',
  needs_repair: 'Needs Repair',
  unusable: 'Unusable',
}

export const EMPTY_CONDITION_COUNTS: ConditionCounts = {
  excellent: 0,
  good: 0,
  fair: 0,
  needs_repair: 0,
  unusable: 0,
}

export function conditionCountsTotal(counts: ConditionCounts): number {
  return CONDITION_KEYS.reduce((sum, key) => sum + counts[key], 0)
}

/**
 * The representative condition: the worst bucket holding at least one unit.
 *
 * Returns null when nothing is classified, which the interface shows as
 * Unclassified rather than inventing a state the data does not support.
 */
export function conditionSummary(counts: ConditionCounts): ConditionKey | null {
  return CONDITION_KEYS.find((key) => counts[key] > 0) ?? null
}

/**
 * Units not accounted for by any condition bucket. Never negative: a count that
 * exceeds the total is a validation failure, not a negative remainder.
 */
export function unclassifiedCount(quantityTotal: number, counts: ConditionCounts): number {
  return Math.max(quantityTotal - conditionCountsTotal(counts), 0)
}

export type InventoryValidationResult = { valid: true } | { valid: false; message: string }

function isNonNegativeInteger(value: number): boolean {
  return Number.isInteger(value) && value >= 0
}

/**
 * The same invariants Security Rules enforce. Checking them here turns a
 * permission-denied into a sentence the user can act on.
 */
export function validateInventoryQuantities(params: {
  quantityTotal: number
  quantityAvailable: number
  conditionCounts: ConditionCounts
}): InventoryValidationResult {
  if (!isNonNegativeInteger(params.quantityTotal)) {
    return { valid: false, message: 'Total quantity must be a whole number of zero or more.' }
  }

  if (!isNonNegativeInteger(params.quantityAvailable)) {
    return { valid: false, message: 'Available quantity must be a whole number of zero or more.' }
  }

  if (params.quantityAvailable > params.quantityTotal) {
    return { valid: false, message: 'Available quantity cannot exceed total quantity.' }
  }

  for (const key of CONDITION_KEYS) {
    if (!isNonNegativeInteger(params.conditionCounts[key])) {
      return {
        valid: false,
        message: `${CONDITION_LABELS[key]} count must be a whole number of zero or more.`,
      }
    }
  }

  if (conditionCountsTotal(params.conditionCounts) > params.quantityTotal) {
    return {
      valid: false,
      message: 'Condition counts add up to more than the total quantity.',
    }
  }

  return { valid: true }
}
