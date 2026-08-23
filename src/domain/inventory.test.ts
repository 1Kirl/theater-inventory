import { describe, expect, it } from 'vitest'
import {
  CONDITION_KEYS,
  EMPTY_CONDITION_COUNTS,
  conditionCountsTotal,
  conditionSummary,
  unclassifiedCount,
  validateInventoryQuantities,
} from '@/domain/inventory'
import type { ConditionCounts } from '@/types/inventory'

function counts(overrides: Partial<ConditionCounts> = {}): ConditionCounts {
  return { ...EMPTY_CONDITION_COUNTS, ...overrides }
}

describe('CONDITION_KEYS', () => {
  it('runs worst to best, which is what makes the summary a simple find', () => {
    expect(CONDITION_KEYS).toEqual(['unusable', 'needs_repair', 'fair', 'good', 'excellent'])
  })
})

describe('conditionSummary', () => {
  it('is null when nothing is classified', () => {
    expect(conditionSummary(EMPTY_CONDITION_COUNTS)).toBeNull()
  })

  it('returns the only non-zero bucket', () => {
    expect(conditionSummary(counts({ good: 4 }))).toBe('good')
  })

  it('lets the worst non-zero bucket win', () => {
    expect(conditionSummary(counts({ excellent: 10, good: 8, unusable: 1 }))).toBe('unusable')
    expect(conditionSummary(counts({ excellent: 10, needs_repair: 1 }))).toBe('needs_repair')
    expect(conditionSummary(counts({ good: 5, fair: 1 }))).toBe('fair')
  })

  it('follows the documented order across every adjacent pair', () => {
    const order = ['unusable', 'needs_repair', 'fair', 'good', 'excellent'] as const
    for (let index = 0; index < order.length - 1; index += 1) {
      const worse = order[index]!
      const better = order[index + 1]!
      expect(conditionSummary(counts({ [worse]: 1, [better]: 99 })), `${worse} over ${better}`).toBe(
        worse,
      )
    }
  })

  it('ignores a bucket at zero', () => {
    expect(conditionSummary(counts({ unusable: 0, good: 3 }))).toBe('good')
  })
})

describe('conditionCountsTotal', () => {
  it('sums every bucket', () => {
    expect(conditionCountsTotal(counts({ excellent: 2, good: 3, unusable: 1 }))).toBe(6)
  })

  it('is zero for an empty breakdown', () => {
    expect(conditionCountsTotal(EMPTY_CONDITION_COUNTS)).toBe(0)
  })
})

describe('unclassifiedCount', () => {
  it('reports the units no bucket accounts for', () => {
    expect(unclassifiedCount(12, counts({ good: 9, fair: 2 }))).toBe(1)
  })

  it('is zero when everything is classified', () => {
    expect(unclassifiedCount(5, counts({ good: 5 }))).toBe(0)
  })

  it('is the whole total when nothing is classified', () => {
    expect(unclassifiedCount(7, EMPTY_CONDITION_COUNTS)).toBe(7)
  })

  it('never goes negative, because an overflow is a validation failure instead', () => {
    expect(unclassifiedCount(3, counts({ good: 10 }))).toBe(0)
  })
})

describe('validateInventoryQuantities', () => {
  const valid = { quantityTotal: 10, quantityAvailable: 8, conditionCounts: counts({ good: 10 }) }

  it('accepts a well-formed item', () => {
    expect(validateInventoryQuantities(valid).valid).toBe(true)
  })

  it('accepts an item with nothing classified yet', () => {
    expect(
      validateInventoryQuantities({ ...valid, conditionCounts: EMPTY_CONDITION_COUNTS }).valid,
    ).toBe(true)
  })

  it('accepts zero of everything', () => {
    expect(
      validateInventoryQuantities({
        quantityTotal: 0,
        quantityAvailable: 0,
        conditionCounts: EMPTY_CONDITION_COUNTS,
      }).valid,
    ).toBe(true)
  })

  it('rejects a negative total', () => {
    expect(validateInventoryQuantities({ ...valid, quantityTotal: -1 }).valid).toBe(false)
  })

  it('rejects a negative available quantity', () => {
    expect(validateInventoryQuantities({ ...valid, quantityAvailable: -1 }).valid).toBe(false)
  })

  it('rejects fractional quantities', () => {
    expect(validateInventoryQuantities({ ...valid, quantityTotal: 10.5 }).valid).toBe(false)
    expect(validateInventoryQuantities({ ...valid, quantityAvailable: 1.5 }).valid).toBe(false)
  })

  it('rejects available exceeding total', () => {
    const result = validateInventoryQuantities({ ...valid, quantityAvailable: 11 })
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.message).toContain('exceed')
  })

  it('rejects a negative condition count', () => {
    expect(
      validateInventoryQuantities({ ...valid, conditionCounts: counts({ good: -1 }) }).valid,
    ).toBe(false)
  })

  it('rejects a fractional condition count', () => {
    expect(
      validateInventoryQuantities({ ...valid, conditionCounts: counts({ good: 2.5 }) }).valid,
    ).toBe(false)
  })

  it('rejects condition counts adding up beyond the total', () => {
    const result = validateInventoryQuantities({
      ...valid,
      conditionCounts: counts({ good: 8, fair: 5 }),
    })
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.message).toContain('more than the total')
  })

  it('accepts condition counts adding up to exactly the total', () => {
    expect(
      validateInventoryQuantities({ ...valid, conditionCounts: counts({ good: 6, fair: 4 }) }).valid,
    ).toBe(true)
  })

  it('explains every failure it reports', () => {
    const result = validateInventoryQuantities({ ...valid, quantityTotal: -1 })
    expect(result.valid).toBe(false)
    if (!result.valid) expect(result.message.length).toBeGreaterThan(0)
  })
})
