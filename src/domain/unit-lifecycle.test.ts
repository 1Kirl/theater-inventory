import { describe, expect, it } from 'vitest'
import {
  EMPTY_MIRRORS, bucketOf, isOperationallyAvailable, withStatusChanged, withUnitsAdded,
  type ItemMirrors,
} from '@/domain/inventory-unit'
import {
  EMPTY_CONDITION_COUNTS, canTransition, conditionCountsTotal, isOfferedTransition,
  offeredTransitions, unitCountsValid,
} from '@/domain/inventory'
import { eventTypeFor } from '@/domain/asset-event-payloads'
import { UNIT_STATUSES, type ConditionKey, type UnitStatus } from '@/types/inventory'

/** Both halves of the stored invariant, asserted after every move. */
function consistent(mirrors: ItemMirrors): boolean {
  return unitCountsValid(mirrors.unit_counts)
    && conditionCountsTotal(mirrors.condition_counts) === mirrors.unit_counts.active_total
}

/** An item holding exactly the units described. */
function itemOf(units: readonly { status: UnitStatus; condition: ConditionKey }[]): ItemMirrors {
  return withUnitsAdded(EMPTY_MIRRORS, units)
}

function move(
  units: readonly { status: UnitStatus; condition: ConditionKey }[],
  change: { condition: ConditionKey; from: UnitStatus; to: UnitStatus },
) {
  const before = itemOf(units)
  const after = withStatusChanged(before, change)
  return { before, after }
}

describe('available → in use', () => {
  it('takes a usable unit off the shelf', () => {
    const { before, after } = move(
      [{ status: 'available', condition: 'good' }],
      { condition: 'good', from: 'available', to: 'in_use' },
    )

    expect(after.unit_counts.available).toBe(before.unit_counts.available - 1)
    expect(after.unit_counts.in_use).toBe(1)
    expect(after.quantity_available).toBe(0)
    // It is still the organization's equipment.
    expect(after.quantity_total).toBe(before.quantity_total)
    expect(after.unit_counts.active_total).toBe(1)
    expect(consistent(after)).toBe(true)
  })

  it('leaves the condition breakdown alone', () => {
    const { before, after } = move(
      [{ status: 'available', condition: 'needs_repair' }],
      { condition: 'needs_repair', from: 'available', to: 'in_use' },
    )

    expect(after.condition_counts).toEqual(before.condition_counts)
  })

  it('lets a needs-repair unit go out, because it still works', () => {
    expect(isOperationallyAvailable({ status: 'available', condition: 'needs_repair' })).toBe(true)
  })

  it('does not consider an unusable unit available to take', () => {
    expect(isOperationallyAvailable({ status: 'available', condition: 'unusable' })).toBe(false)
  })
})

describe('in use → available', () => {
  it('puts a usable unit back on the shelf', () => {
    const { after } = move(
      [{ status: 'in_use', condition: 'good' }],
      { condition: 'good', from: 'in_use', to: 'available' },
    )

    expect(after.unit_counts.in_use).toBe(0)
    expect(after.unit_counts.available).toBe(1)
    expect(after.quantity_available).toBe(1)
    expect(consistent(after)).toBe(true)
  })

  it('returns an unusable unit to stock without returning it to availability', () => {
    // It came back broken. It is on the shelf and no use to anybody.
    const { after } = move(
      [{ status: 'in_use', condition: 'unusable' }],
      { condition: 'unusable', from: 'in_use', to: 'available' },
    )

    expect(after.unit_counts.available).toBe(0)
    expect(after.unit_counts.unusable_on_hand).toBe(1)
    expect(after.quantity_available).toBe(0)
    expect(after.quantity_total).toBe(1)
    expect(consistent(after)).toBe(true)
  })
})

describe('marking a unit lost', () => {
  it('from available and usable, availability drops', () => {
    const { after } = move(
      [{ status: 'available', condition: 'good' }],
      { condition: 'good', from: 'available', to: 'lost' },
    )

    expect(after.unit_counts.available).toBe(0)
    expect(after.unit_counts.lost).toBe(1)
    expect(after.quantity_available).toBe(0)
    // Lost equipment stays in the total: it is missing, not written off.
    expect(after.quantity_total).toBe(1)
    expect(consistent(after)).toBe(true)
  })

  it('from available and unusable, availability was already zero and stays there', () => {
    const { before, after } = move(
      [{ status: 'available', condition: 'unusable' }],
      { condition: 'unusable', from: 'available', to: 'lost' },
    )

    expect(before.quantity_available).toBe(0)
    expect(after.unit_counts.unusable_on_hand).toBe(0)
    expect(after.unit_counts.lost).toBe(1)
    expect(after.quantity_available).toBe(0)
    expect(consistent(after)).toBe(true)
  })

  it('from in use, it leaves the borrowed count', () => {
    const { after } = move(
      [{ status: 'in_use', condition: 'good' }],
      { condition: 'good', from: 'in_use', to: 'lost' },
    )

    expect(after.unit_counts.in_use).toBe(0)
    expect(after.unit_counts.lost).toBe(1)
    expect(consistent(after)).toBe(true)
  })
})

describe('finding a unit again', () => {
  it('a usable one comes back to availability', () => {
    const { after } = move(
      [{ status: 'lost', condition: 'good' }],
      { condition: 'good', from: 'lost', to: 'available' },
    )

    expect(after.unit_counts.lost).toBe(0)
    expect(after.unit_counts.available).toBe(1)
    expect(after.quantity_available).toBe(1)
    expect(consistent(after)).toBe(true)
  })

  it('an unusable one comes back to stock only', () => {
    const { after } = move(
      [{ status: 'lost', condition: 'unusable' }],
      { condition: 'unusable', from: 'lost', to: 'available' },
    )

    expect(after.unit_counts.available).toBe(0)
    expect(after.unit_counts.unusable_on_hand).toBe(1)
    expect(after.quantity_available).toBe(0)
    expect(consistent(after)).toBe(true)
  })
})

describe('retiring a unit', () => {
  it('from available, it leaves the active totals entirely', () => {
    const { after } = move(
      [{ status: 'available', condition: 'good' }],
      { condition: 'good', from: 'available', to: 'retired' },
    )

    expect(after.unit_counts.available).toBe(0)
    expect(after.unit_counts.retired).toBe(1)
    expect(after.unit_counts.active_total).toBe(0)
    expect(after.quantity_total).toBe(0)
    expect(after.quantity_available).toBe(0)
    // A retired unit is no longer in any condition worth counting.
    expect(after.condition_counts).toEqual(EMPTY_CONDITION_COUNTS)
    expect(consistent(after)).toBe(true)
  })

  it('from lost, the total drops but availability was already zero', () => {
    const { after } = move(
      [{ status: 'lost', condition: 'good' }, { status: 'available', condition: 'good' }],
      { condition: 'good', from: 'lost', to: 'retired' },
    )

    expect(after.unit_counts.lost).toBe(0)
    expect(after.unit_counts.retired).toBe(1)
    expect(after.unit_counts.active_total).toBe(1)
    expect(after.quantity_total).toBe(1)
    expect(after.quantity_available).toBe(1)
    expect(consistent(after)).toBe(true)
  })

  it('retiring an unusable unit does not touch availability', () => {
    const { after } = move(
      [{ status: 'available', condition: 'unusable' }, { status: 'available', condition: 'good' }],
      { condition: 'unusable', from: 'available', to: 'retired' },
    )

    expect(after.unit_counts.unusable_on_hand).toBe(0)
    expect(after.quantity_available).toBe(1)
    expect(after.quantity_total).toBe(1)
    expect(consistent(after)).toBe(true)
  })
})

describe('the arithmetic holds for every move', () => {
  it('keeps the invariant across every allowed transition and condition', () => {
    for (const from of UNIT_STATUSES) {
      for (const to of UNIT_STATUSES) {
        if (!canTransition(from, to)) continue

        for (const condition of ['excellent', 'good', 'fair', 'needs_repair', 'unusable'] as const) {
          const after = withStatusChanged(itemOf([{ status: from, condition }]), {
            condition, from, to,
          })
          expect(consistent(after), `${from} → ${to} (${condition})`).toBe(true)
        }
      }
    }
  })

  it('is a no-op when nothing moved', () => {
    const mirrors = itemOf([{ status: 'available', condition: 'good' }])

    expect(withStatusChanged(mirrors, { condition: 'good', from: 'available', to: 'available' }))
      .toEqual(mirrors)
  })

  it('never counts a unit in two buckets at once', () => {
    const after = withStatusChanged(
      itemOf([{ status: 'available', condition: 'good' }]),
      { condition: 'good', from: 'available', to: 'in_use' },
    )
    const { available, unusable_on_hand, in_use, in_maintenance, lost } = after.unit_counts

    expect(available + unusable_on_hand + in_use + in_maintenance + lost)
      .toBe(after.unit_counts.active_total)
  })
})

describe('which moves the application offers', () => {
  it('offers taking out, losing, and retiring an available unit', () => {
    expect([...offeredTransitions('available')]).toEqual(['in_use', 'lost', 'retired'])
  })

  it('offers only checking in and losing a unit that is out', () => {
    // Retiring something you do not have is not a decision anyone can make
    // honestly; get it back or report it lost first.
    expect([...offeredTransitions('in_use')]).toEqual(['available', 'lost'])
  })

  it('offers finding and retiring a lost unit', () => {
    expect([...offeredTransitions('lost')]).toEqual(['available', 'retired'])
  })

  it('offers nothing for a unit in maintenance, which the repair workflow owns', () => {
    expect([...offeredTransitions('in_maintenance')]).toEqual([])
  })

  it('offers nothing for a retired unit, which is terminal', () => {
    expect([...offeredTransitions('retired')]).toEqual([])
  })

  it('never offers a move the model forbids', () => {
    for (const from of UNIT_STATUSES) {
      for (const to of offeredTransitions(from)) {
        expect(canTransition(from, to), `${from} → ${to}`).toBe(true)
      }
    }
  })

  it('offers strictly less than the model allows', () => {
    // The gap is deliberate: maintenance needs a repair record, and this phase
    // cannot create one.
    expect(isOfferedTransition('available', 'in_maintenance')).toBe(false)
    expect(canTransition('available', 'in_maintenance')).toBe(true)
  })
})

describe('which event a move produces', () => {
  it.each([
    ['available', 'in_use', 'marked_in_use'],
    ['in_use', 'available', 'checked_in'],
    ['available', 'lost', 'marked_lost'],
    ['in_use', 'lost', 'marked_lost'],
    ['lost', 'available', 'marked_found'],
    ['available', 'retired', 'retired'],
    ['lost', 'retired', 'retired'],
  ] as const)('%s → %s is recorded as %s', (from, to, expected) => {
    expect(eventTypeFor(from, to)).toBe(expected)
  })

  it('gives every offered move an event to record it', () => {
    for (const from of UNIT_STATUSES) {
      for (const to of offeredTransitions(from)) {
        expect(eventTypeFor(from, to), `${from} → ${to}`).not.toBeNull()
      }
    }
  })
})

describe('bucketOf underpins all of it', () => {
  it('puts a unit in exactly one bucket, or none when retired', () => {
    expect(bucketOf({ status: 'available', condition: 'good' })).toBe('available')
    expect(bucketOf({ status: 'available', condition: 'unusable' })).toBe('unusable_on_hand')
    expect(bucketOf({ status: 'in_use', condition: 'unusable' })).toBe('in_use')
    expect(bucketOf({ status: 'lost', condition: 'good' })).toBe('lost')
    expect(bucketOf({ status: 'retired', condition: 'good' })).toBeNull()
  })
})
