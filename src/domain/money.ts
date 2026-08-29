/**
 * Money, as whole cents.
 *
 * Every amount in this product is an integer number of cents, never a
 * floating-point number of dollars. `0.1 + 0.2` is not `0.3`, and a budget that
 * is wrong by a hundredth of a cent per row is a budget nobody trusts. Cents are
 * exact under addition and under multiplication by a whole quantity, which is
 * all the arithmetic this feature does.
 *
 * One currency, US dollars, for the whole product. The alternative is an
 * organization-level currency setting, and that solves nothing here: a high
 * school theater program plans its season in the currency it buys in, and a
 * second currency would introduce conversion rates, a rate date, and a rounding
 * policy without answering any question the program actually has.
 *
 * None of this is accounting. These are planning estimates — what something
 * would cost to replace, what a production expects to spend — and the wording
 * throughout says so.
 */

/**
 * The most one unit of anything may cost: $1,000,000.00.
 *
 * Three orders of magnitude above the most expensive thing a school theater
 * buys, so it never obstructs real data, while still catching a misplaced
 * decimal point or a paste of the wrong field. It also keeps
 * `quantity × unit cost` far inside exact integer range for any quantity a
 * person types into a form.
 */
export const MAX_UNIT_COST_CENTS = 100_000_000

export type MoneyParse =
  /** `cents` is null when the field was left blank, which means unknown. */
  | { valid: true; cents: number | null }
  | { valid: false; message: string }

/**
 * Reads what somebody typed into a money field.
 *
 * Accepts the forms people actually type — `12`, `12.5`, `12.50`, `0.99`, and
 * the `$1,250.00` that comes back from a paste. Blank is a valid answer meaning
 * unknown, which is different from zero and is kept different everywhere.
 *
 * The conversion never multiplies a float by 100: `1.15 * 100` is
 * `114.99999999999999`, and that rounds to a cent less than the person typed.
 * The digits are read as digits instead.
 */
export function parseMoneyToCents(input: string): MoneyParse {
  const trimmed = input.trim()
  if (trimmed.length === 0) return { valid: true, cents: null }

  // A leading currency symbol and thousands separators are noise from a paste,
  // not an attempt to type something else.
  const cleaned = trimmed.replace(/^\$/, '').replace(/,/g, '').trim()

  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) {
    if (/^-/.test(trimmed) || /^\$-/.test(trimmed)) {
      return { valid: false, message: 'Cost cannot be negative.' }
    }
    if (/^\d+\.\d{3,}$/.test(cleaned)) {
      return { valid: false, message: 'Use at most two decimal places, like 18.50.' }
    }
    return { valid: false, message: 'Enter an amount like 18.50.' }
  }

  const [whole = '0', fraction = ''] = cleaned.split('.')
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))

  if (!Number.isSafeInteger(cents)) {
    return { valid: false, message: 'That amount is too large.' }
  }
  if (cents > MAX_UNIT_COST_CENTS) {
    return {
      valid: false,
      message: `Cost must be ${formatCents(MAX_UNIT_COST_CENTS)} or less.`,
    }
  }

  return { valid: true, cents }
}

/** Whether a stored value is one this product would have written. */
export function isValidCostCents(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 0
    && value <= MAX_UNIT_COST_CENTS
}

/** `125000` becomes `$1,250.00`. Built from the digits, so no locale surprises. */
export function formatCents(cents: number): string {
  const negative = cents < 0
  const absolute = Math.abs(cents)
  const whole = Math.trunc(absolute / 100)
  const fraction = absolute % 100

  const grouped = String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',')

  return `${negative ? '-' : ''}$${grouped}.${String(fraction).padStart(2, '0')}`
}

/** What an unset amount reads as. Never `$0.00`, which is a different claim. */
export const UNKNOWN_COST_LABEL = 'Cost unknown'

export function formatCostOrUnknown(cents: number | undefined | null): string {
  return isValidCostCents(cents) ? formatCents(cents) : UNKNOWN_COST_LABEL
}

/**
 * Quantity times unit cost, or null when the cost is unknown.
 *
 * Null rather than zero, so that a caller has to decide what to do about a
 * missing estimate instead of quietly adding nothing to a total and presenting
 * it as complete.
 */
export function calculateEstimatedCost(
  quantity: number,
  unitCostCents: number | undefined | null,
): number | null {
  if (!isValidCostCents(unitCostCents)) return null
  if (!Number.isSafeInteger(quantity) || quantity < 0) return null

  const total = quantity * unitCostCents
  return Number.isSafeInteger(total) ? total : null
}

/** For the input field, so editing an existing amount starts from what is stored. */
export function centsToInputValue(cents: number | undefined | null): string {
  if (!isValidCostCents(cents)) return ''
  return `${String(Math.trunc(cents / 100))}.${String(cents % 100).padStart(2, '0')}`
}
