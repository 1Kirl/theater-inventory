import { describe, expect, it } from 'vitest'
import {
  MAX_UNIT_COST_CENTS, UNKNOWN_COST_LABEL, calculateEstimatedCost, centsToInputValue,
  formatCents, formatCostOrUnknown, isValidCostCents, parseMoneyToCents,
} from '@/domain/money'

function cents(input: string): number | null {
  const parsed = parseMoneyToCents(input)
  if (!parsed.valid) throw new Error(`expected ${input} to parse: ${parsed.message}`)
  return parsed.cents
}

describe('reading what somebody typed into a money field', () => {
  it.each([
    ['0', 0],
    ['0.00', 0],
    ['0.01', 1],
    ['0.99', 99],
    ['1', 100],
    ['1.1', 110],
    ['1.10', 110],
    ['12.5', 1250],
    ['12.50', 1250],
    ['18.50', 1850],
    ['249', 24900],
    ['1250.00', 125000],
  ])('reads %s as %i cents', (input, expected) => {
    expect(cents(input)).toBe(expected)
  })

  it('reads a value a float would get wrong', () => {
    // 1.15 * 100 is 114.99999999999999 in JavaScript, which truncates to a cent
    // less than the person typed. The digits are read as digits instead.
    expect(cents('1.15')).toBe(115)
    expect(cents('8.29')).toBe(829)
    // And a third decimal is refused outright rather than rounded to 100 or 101.
    expect(parseMoneyToCents('1.005').valid).toBe(false)
  })

  it('accepts a pasted amount with a symbol and separators', () => {
    expect(cents('$1,250.00')).toBe(125000)
    expect(cents('$18.50')).toBe(1850)
    expect(cents('1,000')).toBe(100000)
  })

  it('ignores surrounding whitespace', () => {
    expect(cents('  12.50  ')).toBe(1250)
  })

  it('treats blank as unknown, which is not zero', () => {
    // The distinction carries all the way to the screen: an item with no cost
    // recorded says so, rather than claiming to be free.
    expect(cents('')).toBeNull()
    expect(cents('   ')).toBeNull()
    expect(cents('0')).toBe(0)
  })

  it('accepts the largest allowed amount', () => {
    expect(cents('1000000.00')).toBe(MAX_UNIT_COST_CENTS)
  })
})

describe('what a money field refuses', () => {
  function refusal(input: string): string {
    const parsed = parseMoneyToCents(input)
    expect(parsed.valid, `expected ${input} to be refused`).toBe(false)
    return parsed.valid ? '' : parsed.message
  }

  it('refuses a negative amount, and says why', () => {
    expect(refusal('-1')).toContain('negative')
    expect(refusal('-0.01')).toContain('negative')
    expect(refusal('$-5.00')).toContain('negative')
  })

  it('refuses more than two decimal places rather than rounding silently', () => {
    // Rounding somebody's number without telling them is how an estimate stops
    // matching the quote it came from.
    expect(refusal('1.005')).toContain('two decimal places')
    expect(refusal('12.3456')).toContain('two decimal places')
  })

  it('refuses text', () => {
    for (const junk of ['abc', '12abc', 'twelve', '1.2.3', '$', '.', '--5']) {
      expect(parseMoneyToCents(junk).valid, junk).toBe(false)
    }
  })

  it('refuses the values that are not numbers at all', () => {
    for (const junk of ['NaN', 'Infinity', '-Infinity', '1e5', '0x10']) {
      expect(parseMoneyToCents(junk).valid, junk).toBe(false)
    }
  })

  it('refuses more than the maximum, and names it', () => {
    expect(refusal('1000000.01')).toContain('$1,000,000.00')
    expect(refusal('99999999')).toContain('$1,000,000.00')
  })
})

describe('showing an amount', () => {
  it.each([
    [0, '$0.00'],
    [1, '$0.01'],
    [99, '$0.99'],
    [100, '$1.00'],
    [110, '$1.10'],
    [1250, '$12.50'],
    [24900, '$249.00'],
    [125000, '$1,250.00'],
    [100000000, '$1,000,000.00'],
  ])('shows %i cents as %s', (input, expected) => {
    expect(formatCents(input)).toBe(expected)
  })

  it('groups thousands the way a person reads them', () => {
    expect(formatCents(999_99)).toBe('$999.99')
    expect(formatCents(1_000_00)).toBe('$1,000.00')
    expect(formatCents(12_345_67)).toBe('$12,345.67')
  })

  it('shows a negative as negative rather than disguising it', () => {
    // Nothing should ever write one. If something does, it must be visible.
    expect(formatCents(-500)).toBe('-$5.00')
  })

  it('round-trips through the input field', () => {
    for (const value of [0, 1, 99, 100, 1250, 125000, MAX_UNIT_COST_CENTS]) {
      expect(cents(centsToInputValue(value))).toBe(value)
    }
  })

  it('leaves the input field empty when nothing is stored', () => {
    expect(centsToInputValue(undefined)).toBe('')
    expect(centsToInputValue(null)).toBe('')
  })
})

describe('an amount that was never recorded', () => {
  it('says so, rather than saying it is free', () => {
    expect(formatCostOrUnknown(undefined)).toBe(UNKNOWN_COST_LABEL)
    expect(formatCostOrUnknown(null)).toBe(UNKNOWN_COST_LABEL)
    expect(UNKNOWN_COST_LABEL).not.toContain('0')
  })

  it('is still different from an amount recorded as zero', () => {
    // Free and unrecorded are different facts, and a plan built on one is not
    // the same as a plan built on the other.
    expect(formatCostOrUnknown(0)).toBe('$0.00')
  })

  it('treats a stored value this product would never write as unknown', () => {
    for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY,
      MAX_UNIT_COST_CENTS + 1, '1250' as unknown as number]) {
      expect(isValidCostCents(bad)).toBe(false)
      expect(formatCostOrUnknown(bad)).toBe(UNKNOWN_COST_LABEL)
    }
  })
})

describe('quantity times unit cost', () => {
  it.each([
    [0, 1850, 0],
    [1, 1850, 1850],
    [5, 1850, 9250],
    [3, 4000, 12000],
    [2, 6500, 13000],
    [1, 7500, 7500],
  ])('%i at %i cents is %i cents', (quantity, unitCost, expected) => {
    expect(calculateEstimatedCost(quantity, unitCost)).toBe(expected)
  })

  it('does not drift the way floating-point dollars would', () => {
    // 3 * 0.1 is 0.30000000000000004 in dollars. In cents it is 30.
    expect(formatCents(calculateEstimatedCost(3, 10) ?? -1)).toBe('$0.30')
    expect(formatCents(calculateEstimatedCost(7, 115) ?? -1)).toBe('$8.05')
    expect(formatCents(calculateEstimatedCost(100, 1) ?? -1)).toBe('$1.00')
  })

  it('costs nothing when the unit cost is zero', () => {
    expect(calculateEstimatedCost(9, 0)).toBe(0)
  })

  it('stays unknown when the unit cost is unknown', () => {
    // Not zero. A caller has to decide what to do about a missing estimate
    // instead of quietly adding nothing and calling the total complete.
    expect(calculateEstimatedCost(5, undefined)).toBeNull()
    expect(calculateEstimatedCost(5, null)).toBeNull()
  })

  it('handles a large but legitimate order', () => {
    expect(calculateEstimatedCost(500, 1850)).toBe(925_000)
    expect(formatCents(925_000)).toBe('$9,250.00')
  })

  it('refuses a quantity that is not a whole count', () => {
    expect(calculateEstimatedCost(-1, 1850)).toBeNull()
    expect(calculateEstimatedCost(1.5, 1850)).toBeNull()
    expect(calculateEstimatedCost(Number.NaN, 1850)).toBeNull()
  })

  it('refuses a product that would leave exact integer range', () => {
    expect(calculateEstimatedCost(Number.MAX_SAFE_INTEGER, MAX_UNIT_COST_CENTS)).toBeNull()
  })
})
