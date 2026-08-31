import { describe, expect, it } from 'vitest'
import { CONDITION_KEYS, isUnitAvailable, unitCountsFrom } from '@/domain/inventory'
import { bucketOf, isOperationallyAvailable } from '@/domain/inventory-unit'
import { UNIT_STATUSES, type ConditionKey, type InventoryUnit, type UnitStatus } from '@/types/inventory'

/**
 * One question, asked in four places, which must give one answer.
 *
 * "Is this piece of equipment available?" is decided by `isUnitAvailable`, but
 * three other things ask it under different names: `bucketOf`, which sorts a
 * unit into the counts its parent stores; `isOperationallyAvailable`, which the
 * AI context uses to tell the model what the organization actually has; and
 * `unitCountsFrom`, which produces the mirror the dashboard, production
 * shortages, and the inventory list all read.
 *
 * Today the last three delegate to the first. Nothing enforces that they keep
 * doing so, and the failure would be quiet: the AI would describe a microphone
 * as available while the shortage calculation treated it as not, and neither
 * screen would look wrong on its own. This pins the agreement rather than the
 * implementation, so a future divergence fails here instead of in a rehearsal.
 */

const unit = (status: UnitStatus, condition: ConditionKey) =>
  ({ status, condition } as InventoryUnit)

/** Every state a unit can actually be in. */
const EVERY_STATE = UNIT_STATUSES.flatMap((status) =>
  CONDITION_KEYS.map((condition) => unit(status, condition)))

describe('availability means the same thing everywhere', () => {
  it('1. all three predicates agree for every status and condition', () => {
    for (const one of EVERY_STATE) {
      const authoritative = isUnitAvailable(one)
      expect({
        state: `${one.status}/${one.condition}`,
        operational: isOperationallyAvailable(one),
        bucket: bucketOf(one) === 'available',
      }).toEqual({
        state: `${one.status}/${one.condition}`,
        operational: authoritative,
        bucket: authoritative,
      })
    }
  })

  it('2. the stored mirror counts exactly what the predicate accepts', () => {
    // The mirror is what the dashboard, the inventory list, and production
    // shortage all read. If it and the predicate disagreed, every screen would
    // be consistent with the others and all of them wrong.
    const counts = unitCountsFrom(EVERY_STATE)
    expect(counts.available).toBe(EVERY_STATE.filter(isUnitAvailable).length)
  })

  it('3. needs-repair equipment on the shelf is still available', () => {
    // A deliberate product rule: it needs attention, not that it has stopped
    // working. Charting or planning against the opposite would understate what
    // the program can actually put on stage.
    const one = unit('available', 'needs_repair')
    expect(isUnitAvailable(one)).toBe(true)
    expect(isOperationallyAvailable(one)).toBe(true)
    expect(bucketOf(one)).toBe('available')
  })

  it('4. unusable equipment on the shelf is present but not available', () => {
    const one = unit('available', 'unusable')
    expect(isUnitAvailable(one)).toBe(false)
    expect(isOperationallyAvailable(one)).toBe(false)
    expect(bucketOf(one)).toBe('unusable_on_hand')
  })

  it('5. nothing that has left the shelf counts as available, whatever its condition', () => {
    for (const status of UNIT_STATUSES) {
      if (status === 'available') continue
      for (const condition of CONDITION_KEYS) {
        expect(isUnitAvailable(unit(status, condition))).toBe(false)
      }
    }
  })

  it('6. a retired unit belongs to no active bucket', () => {
    for (const condition of CONDITION_KEYS) {
      expect(bucketOf(unit('retired', condition))).toBeNull()
    }
  })

  it('7. a lost unit stays active, so it is still part of the total', () => {
    const counts = unitCountsFrom([unit('lost', 'good')])
    expect(counts.lost).toBe(1)
    expect(counts.active_total).toBe(1)
    expect(counts.retired).toBe(0)
  })

  it('8. the active buckets always add up to active_total', () => {
    const counts = unitCountsFrom(EVERY_STATE)
    const summed = counts.available + counts.unusable_on_hand + counts.in_use
      + counts.in_maintenance + counts.lost
    expect(summed).toBe(counts.active_total)
  })
})
