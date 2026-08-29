import { describe, expect, it } from 'vitest'
import { buildInventoryItemDocument, buildInventoryItemUpdate } from '@/domain/inventory-payloads'
import { buildActionItemDocument } from '@/domain/production-payloads'
import { EMPTY_CONDITION_COUNTS } from '@/domain/inventory'
import { MAX_UNIT_COST_CENTS } from '@/domain/money'
import type { Timestamp } from 'firebase/firestore'

const NOW = (() => 'SERVER_TIME') as unknown as () => never
const CREATED = 'CREATED_AT' as unknown as Timestamp

const UNIT_COUNTS = {
  active_total: 10, available: 6, unusable_on_hand: 1, in_use: 2,
  in_maintenance: 1, lost: 0, retired: 4,
}

function itemInput(unitCostCents?: number | null) {
  return {
    name: 'Wireless Handheld',
    category: 'Microphones',
    teamId: 'team-sound',
    trackingMode: 'serialized' as const,
    unitCounts: UNIT_COUNTS,
    quantityTotal: 10,
    quantityAvailable: 6,
    conditionCounts: { ...EMPTY_CONDITION_COUNTS, good: 6, needs_repair: 4 },
    location: 'Booth',
    ...(unitCostCents === undefined ? {} : { unitCostCents }),
  }
}

function item(unitCostCents?: number | null): Record<string, unknown> {
  return buildInventoryItemDocument({
    itemId: 'item-1', organizationId: 'org-a', uid: 'uid-1', now: NOW,
    input: itemInput(unitCostCents),
  })
}

describe('recording what an item costs', () => {
  it('writes whole cents under the documented field name', () => {
    expect(item(24900).unit_cost_cents).toBe(24900)
  })

  it('writes zero, because somebody deciding it is free is an answer', () => {
    // Truthiness would drop this and turn a recorded zero into "unknown".
    expect(item(0)).toHaveProperty('unit_cost_cents', 0)
  })

  it('writes nothing at all when the cost is unknown', () => {
    // Absent, not zero. The two mean different things everywhere else.
    expect('unit_cost_cents' in item(undefined)).toBe(false)
    expect('unit_cost_cents' in item(null)).toBe(false)
  })

  it('refuses to persist a value Rules would reject', () => {
    // The builder is what the Rules tests exercise, so a value that would be
    // denied must never leave here in the first place.
    for (const bad of [-1, 12.5, Number.NaN, MAX_UNIT_COST_CENTS + 1]) {
      expect('unit_cost_cents' in item(bad), String(bad)).toBe(false)
    }
  })

  it('accepts the maximum', () => {
    expect(item(MAX_UNIT_COST_CENTS).unit_cost_cents).toBe(MAX_UNIT_COST_CENTS)
  })
})

describe('a cost edit is metadata and nothing else', () => {
  function update(unitCostCents?: number): Record<string, unknown> {
    return buildInventoryItemUpdate({
      itemId: 'item-1', organizationId: 'org-a', createdByUid: 'uid-1', createdAt: CREATED,
      now: NOW, input: itemInput(unitCostCents),
    })
  }

  const before = update()
  const after = update(24900)

  it('changes exactly one field', () => {
    const changed = Object.keys(after).filter(
      (key) => JSON.stringify(after[key]) !== JSON.stringify(before[key]),
    )
    expect(changed).toEqual(['unit_cost_cents'])
  })

  it('leaves the physical counts of a serialized item untouched', () => {
    // Pricing a microphone does not move one. The counts are mirrored from the
    // units, and nothing about money may disturb them.
    expect(after.unit_counts).toEqual(UNIT_COUNTS)
    expect(after.quantity_total).toBe(10)
    expect(after.quantity_available).toBe(6)
    expect(after.condition_counts).toEqual(before.condition_counts)
  })

  it('leaves identity and authorship untouched', () => {
    expect(after.item_id).toBe('item-1')
    expect(after.created_by_uid).toBe('uid-1')
    expect(after.created_at).toBe(CREATED)
    expect(after.tracking_mode).toBe('serialized')
  })
})

describe('recording what an action is expected to cost', () => {
  function action(estimatedUnitCostCents?: number | null): Record<string, unknown> {
    return buildActionItemDocument({
      requirementId: 'req-1', organizationId: 'org-a', productionId: 'prod-1',
      itemName: 'Wireless Handheld', teamId: 'team-sound', uid: 'uid-1', now: NOW,
      input: {
        actionType: 'buy',
        quantity: 3,
        status: 'todo',
        ...(estimatedUnitCostCents === undefined ? {} : { estimatedUnitCostCents }),
      },
    })
  }

  it('writes whole cents per unit', () => {
    expect(action(1850).estimated_unit_cost_cents).toBe(1850)
  })

  it('writes zero as a decision', () => {
    expect(action(0)).toHaveProperty('estimated_unit_cost_cents', 0)
  })

  it('writes nothing when nobody has estimated it', () => {
    expect('estimated_unit_cost_cents' in action(undefined)).toBe(false)
    expect('estimated_unit_cost_cents' in action(null)).toBe(false)
  })

  it('never writes a line total, which would be a second number to drift', () => {
    // Quantity times unit cost is derived wherever it is shown. There is one
    // number stored, so there is nothing for it to disagree with.
    const document = action(1850)
    expect('estimated_total_cost_cents' in document).toBe(false)
    expect(Object.keys(document).filter((key) => key.includes('total'))).toEqual([])
  })

  it('refuses to persist a value Rules would reject', () => {
    for (const bad of [-1, 18.5, Number.NaN, MAX_UNIT_COST_CENTS + 1]) {
      expect('estimated_unit_cost_cents' in action(bad), String(bad)).toBe(false)
    }
  })
})
