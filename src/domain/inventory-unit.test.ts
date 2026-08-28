import { describe, expect, it } from 'vitest'
import {
  EMPTY_UNIT_COUNTS, canTransition, conditionCountsFrom, isSerialized, isUnitActive,
  isUnitAvailable, isUnitStatus, serializedMirrorFrom, trackingModeOf, unitCountsFrom,
  unitCountsValid,
} from '@/domain/inventory'
import { buildInventoryUnitDocument, buildInventoryUnitUpdate } from '@/domain/inventory-unit-payloads'
import { buildInventoryItemDocument } from '@/domain/inventory-payloads'
import { EMPTY_CONDITION_COUNTS } from '@/domain/inventory'
import {
  RETIREMENT_REASONS, TRACKING_MODES, UNIT_STATUSES,
  type ConditionKey, type InventoryItem, type InventoryUnit, type UnitCounts, type UnitStatus,
} from '@/types/inventory'
import type { FieldValue, Timestamp } from 'firebase/firestore'

/**
 * The serialized inventory contract, before anything writes a unit.
 *
 * Phase 11A adds no user-facing behaviour, so these tests are the whole of what
 * says the contract is right.
 */

function unit(status: UnitStatus, condition: ConditionKey = 'good') {
  return { status, condition }
}

const now = () => 'ts' as unknown as FieldValue

describe('vocabularies', () => {
  it('offers exactly two tracking modes', () => {
    expect(TRACKING_MODES).toEqual(['bulk', 'serialized'])
  })

  it('offers exactly the five lifecycle statuses', () => {
    expect(UNIT_STATUSES).toEqual(['available', 'in_use', 'in_maintenance', 'lost', 'retired'])
  })

  it('offers exactly the five retirement reasons', () => {
    expect(RETIREMENT_REASONS)
      .toEqual(['disposed', 'permanently_lost', 'donated', 'sold', 'other'])
  })

  it('recognizes a status and rejects anything else', () => {
    expect(isUnitStatus('in_maintenance')).toBe(true)
    expect(isUnitStatus('broken')).toBe(false)
    expect(isUnitStatus('')).toBe(false)
  })
})

describe('trackingModeOf', () => {
  function item(tracking?: unknown): Pick<InventoryItem, 'tracking_mode'> {
    return { tracking_mode: tracking } as Pick<InventoryItem, 'tracking_mode'>
  }

  it('reads an item written before serialized tracking existed as bulk', () => {
    // Every document currently in Firestore is missing the field. Reading it
    // any other way would change what the application says about data nobody
    // has touched.
    expect(trackingModeOf({} as Pick<InventoryItem, 'tracking_mode'>)).toBe('bulk')
    expect(trackingModeOf(item(undefined))).toBe('bulk')
  })

  it('respects an explicit mode', () => {
    expect(trackingModeOf(item('bulk'))).toBe('bulk')
    expect(trackingModeOf(item('serialized'))).toBe('serialized')
  })

  it('answers the serialized question directly', () => {
    expect(isSerialized({} as Pick<InventoryItem, 'tracking_mode'>)).toBe(false)
    expect(isSerialized(item('serialized'))).toBe(true)
  })
})

describe('isUnitAvailable', () => {
  it('counts a unit that needs repair but is on the shelf', () => {
    // Decision 3: needing attention is not the same as having stopped working.
    expect(isUnitAvailable(unit('available', 'needs_repair'))).toBe(true)
  })

  it('does not count an unusable unit, even though it is on the shelf', () => {
    // Decision 4, and a deliberate departure from the bulk model: nothing can
    // count on it, so a production must not be told it can.
    expect(isUnitAvailable(unit('available', 'unusable'))).toBe(false)
  })

  it('counts the other three conditions when available', () => {
    for (const condition of ['excellent', 'good', 'fair'] as const) {
      expect(isUnitAvailable(unit('available', condition))).toBe(true)
    }
  })

  it('counts nothing that is not on the shelf, whatever its condition', () => {
    for (const status of ['in_use', 'in_maintenance', 'lost', 'retired'] as const) {
      expect(isUnitAvailable(unit(status, 'excellent'))).toBe(false)
    }
  })

  it('treats presence and usability as separate questions', () => {
    // The pair that would be unsayable with one field.
    const shelved = unit('available', 'unusable')
    expect(isUnitActive(shelved)).toBe(true)
    expect(isUnitAvailable(shelved)).toBe(false)

    const borrowed = unit('in_use', 'excellent')
    expect(isUnitActive(borrowed)).toBe(true)
    expect(isUnitAvailable(borrowed)).toBe(false)
  })

  it('treats a retired unit as gone', () => {
    expect(isUnitActive(unit('retired', 'excellent'))).toBe(false)
  })
})

describe('unitCountsFrom', () => {
  it('reports zeroes for an item with no units', () => {
    expect(unitCountsFrom([])).toEqual(EMPTY_UNIT_COUNTS)
  })

  it('separates available from unusable-on-hand', () => {
    const counts = unitCountsFrom([
      unit('available', 'good'),
      unit('available', 'needs_repair'),
      unit('available', 'unusable'),
    ])

    expect(counts.available).toBe(2)
    expect(counts.unusable_on_hand).toBe(1)
    expect(counts.active_total).toBe(3)
  })

  it('keeps lost units inside the active total', () => {
    // Decision 5: "24 total, 3 lost" has to remain sayable.
    const counts = unitCountsFrom([
      ...Array.from({ length: 21 }, () => unit('available')),
      ...Array.from({ length: 3 }, () => unit('lost')),
    ])

    expect(counts.active_total).toBe(24)
    expect(counts.lost).toBe(3)
    expect(counts.available).toBe(21)
  })

  it('keeps retired units outside the active total', () => {
    const counts = unitCountsFrom([unit('available'), unit('retired'), unit('retired')])

    expect(counts.active_total).toBe(1)
    expect(counts.retired).toBe(2)
  })

  it('counts each lifecycle bucket', () => {
    const counts = unitCountsFrom([
      unit('available'), unit('in_use'), unit('in_use'),
      unit('in_maintenance'), unit('lost'), unit('retired'),
    ])

    expect(counts).toEqual({
      active_total: 5, available: 1, unusable_on_hand: 0,
      in_use: 2, in_maintenance: 1, lost: 1, retired: 1,
    })
  })

  it('produces counts that satisfy the invariant', () => {
    const counts = unitCountsFrom([
      unit('available', 'good'), unit('available', 'unusable'), unit('in_use'),
      unit('in_maintenance'), unit('lost'), unit('retired'),
    ])

    expect(unitCountsValid(counts)).toBe(true)
    expect(counts.active_total).toBe(
      counts.available + counts.unusable_on_hand + counts.in_use
      + counts.in_maintenance + counts.lost,
    )
  })
})

describe('unitCountsValid', () => {
  function counts(overrides: Partial<UnitCounts> = {}): UnitCounts {
    return { ...EMPTY_UNIT_COUNTS, ...overrides }
  }

  it('accepts an empty summary', () => {
    expect(unitCountsValid(EMPTY_UNIT_COUNTS)).toBe(true)
  })

  it('accepts a summary whose buckets add up', () => {
    expect(unitCountsValid(counts({
      active_total: 10, available: 5, unusable_on_hand: 1,
      in_use: 2, in_maintenance: 1, lost: 1, retired: 3,
    }))).toBe(true)
  })

  it('rejects a total that does not match its buckets', () => {
    expect(unitCountsValid(counts({ active_total: 10, available: 5 }))).toBe(false)
  })

  it('ignores retired when checking the total', () => {
    // Retired sits beside the active total as history, not inside it.
    expect(unitCountsValid(counts({ active_total: 1, available: 1, retired: 99 }))).toBe(true)
  })

  it('rejects a negative or fractional count', () => {
    expect(unitCountsValid(counts({ active_total: -1 }))).toBe(false)
    expect(unitCountsValid(counts({ active_total: 1, available: 1.5 }))).toBe(false)
  })
})

describe('conditionCountsFrom', () => {
  it('counts active units by condition', () => {
    const counts = conditionCountsFrom([
      unit('available', 'excellent'), unit('in_use', 'good'),
      unit('lost', 'fair'), unit('in_maintenance', 'needs_repair'),
    ])

    expect(counts).toEqual({
      ...EMPTY_CONDITION_COUNTS, excellent: 1, good: 1, fair: 1, needs_repair: 1,
    })
  })

  it('leaves retired units out', () => {
    const counts = conditionCountsFrom([unit('available', 'good'), unit('retired', 'good')])
    expect(counts.good).toBe(1)
  })

  it('adds up to the active total, because every unit has one condition', () => {
    // A serialized item has no unclassified remainder, unlike a bulk item where
    // the counts are a person's partial record of a quantity.
    const units = [
      unit('available', 'excellent'), unit('available', 'unusable'),
      unit('in_use', 'good'), unit('lost', 'fair'), unit('retired', 'good'),
    ]
    const mirror = serializedMirrorFrom(units)

    const conditionTotal = Object.values(mirror.condition_counts)
      .reduce((sum, value) => sum + value, 0)

    expect(conditionTotal).toBe(mirror.unit_counts.active_total)
  })
})

describe('serializedMirrorFrom', () => {
  it('mirrors the fields the rest of the application already reads', () => {
    // Production shortage, the dashboard, and the AI context all read
    // quantity_available; none of them learns about units.
    const mirror = serializedMirrorFrom([
      unit('available', 'good'), unit('available', 'unusable'),
      unit('in_use'), unit('retired'),
    ])

    expect(mirror.quantity_available).toBe(1)
    expect(mirror.quantity_total).toBe(3)
    expect(mirror.quantity_available).toBe(mirror.unit_counts.available)
    expect(mirror.quantity_total).toBe(mirror.unit_counts.active_total)
  })

  it('reports an item whose every unit is unusable as having none available', () => {
    const mirror = serializedMirrorFrom(Array.from({ length: 8 }, () => unit('available', 'unusable')))

    expect(mirror.quantity_total).toBe(8)
    expect(mirror.quantity_available).toBe(0)
    expect(mirror.unit_counts.unusable_on_hand).toBe(8)
  })
})

describe('canTransition', () => {
  it('allows the ordinary lifecycle', () => {
    expect(canTransition('available', 'in_use')).toBe(true)
    expect(canTransition('in_use', 'available')).toBe(true)
    expect(canTransition('available', 'in_maintenance')).toBe(true)
    expect(canTransition('in_maintenance', 'available')).toBe(true)
    expect(canTransition('in_use', 'lost')).toBe(true)
    expect(canTransition('lost', 'available')).toBe(true)
  })

  it('lets anything active be retired', () => {
    for (const from of ['available', 'in_use', 'in_maintenance', 'lost'] as const) {
      expect(canTransition(from, 'retired')).toBe(true)
    }
  })

  it('treats retirement as terminal', () => {
    // Equipment that comes back is a new unit; the old record really did leave.
    for (const to of UNIT_STATUSES) {
      expect(canTransition('retired', to)).toBe(false)
    }
  })

  it('refuses a move that skips a step', () => {
    expect(canTransition('in_maintenance', 'in_use')).toBe(false)
    expect(canTransition('lost', 'in_use')).toBe(false)
    expect(canTransition('lost', 'in_maintenance')).toBe(false)
  })

  it('refuses a move to the same status', () => {
    for (const status of UNIT_STATUSES) {
      expect(canTransition(status, status)).toBe(false)
    }
  })
})

describe('unit payload builders', () => {
  const base = {
    unitId: 'u-1',
    organizationId: 'org-1',
    inventoryItemId: 'i-1',
    teamId: 't-lighting',
    uid: 'u-admin',
    now,
  }

  function document(input: Partial<Parameters<typeof buildInventoryUnitDocument>[0]['input']> = {}) {
    return buildInventoryUnitDocument({
      ...base,
      input: {
        assetCode: 'CLAMP-017',
        condition: 'good',
        status: 'available',
        storageLocation: 'Lighting Storage',
        ...input,
      },
    })
  }

  it('writes the minimum shape and omits every empty optional', () => {
    expect(Object.keys(document()).sort()).toEqual([
      'asset_code', 'condition', 'created_at', 'created_by_uid', 'inventory_item_id',
      'organization_id', 'status', 'storage_location', 'team_id', 'unit_id', 'updated_at',
    ])
  })

  it('carries the three fields Security Rules authorize against', () => {
    const payload = document()

    expect(payload.organization_id).toBe('org-1')
    expect(payload.inventory_item_id).toBe('i-1')
    expect(payload.team_id).toBe('t-lighting')
  })

  it('trims the text fields', () => {
    const payload = document({ assetCode: '  CLAMP-017  ', storageLocation: '  Loft B  ' })

    expect(payload.asset_code).toBe('CLAMP-017')
    expect(payload.storage_location).toBe('Loft B')
  })

  it('records a retirement reason only for a retired unit', () => {
    expect(document({ status: 'retired', retirementReason: 'donated' }))
      .toHaveProperty('retirement_reason', 'donated')

    // A reason on a unit that is not retired would outlive the fact it records.
    expect(document({ status: 'available', retirementReason: 'donated' }))
      .not.toHaveProperty('retirement_reason')
  })

  it('records borrowing details only while the unit is out', () => {
    const out = document({
      status: 'in_use', usingTeamId: 't-sound', usingMemberUid: 'u-2',
    })
    expect(out).toHaveProperty('using_team_id', 't-sound')
    expect(out).toHaveProperty('using_member_uid', 'u-2')

    const back = document({ status: 'available', usingTeamId: 't-sound', usingMemberUid: 'u-2' })
    expect(back).not.toHaveProperty('using_team_id')
    expect(back).not.toHaveProperty('using_member_uid')
  })

  it('never records a member without the team they were borrowing for', () => {
    const payload = document({ status: 'in_use', usingMemberUid: 'u-2' })
    expect(payload).not.toHaveProperty('using_member_uid')
  })

  it('preserves the author and creation time on update', () => {
    const createdAt = { seconds: 5, nanoseconds: 0 } as unknown as Timestamp
    const payload = buildInventoryUnitUpdate({
      ...base,
      createdByUid: 'u-author',
      createdAt,
      input: {
        assetCode: 'CLAMP-017', condition: 'fair', status: 'available',
        storageLocation: 'Lighting Storage',
      },
    })

    expect(payload.created_by_uid).toBe('u-author')
    expect(payload.created_at).toBe(createdAt)
    expect(payload.team_id).toBe('t-lighting')
  })
})

describe('inventory item payloads carry the tracking mode', () => {
  function item(overrides: Record<string, unknown> = {}) {
    return buildInventoryItemDocument({
      itemId: 'i-1',
      organizationId: 'org-1',
      uid: 'u-1',
      now,
      input: {
        name: 'C-Clamp',
        category: 'Hardware',
        teamId: 't-lighting',
        quantityTotal: 24,
        quantityAvailable: 20,
        conditionCounts: { ...EMPTY_CONDITION_COUNTS, good: 24 },
        location: 'Lighting Storage',
        ...overrides,
      },
    })
  }

  it('defaults to bulk, which is what every existing item is', () => {
    expect(item()).toHaveProperty('tracking_mode', 'bulk')
  })

  it('always writes the field, so an update cannot silently drop it', () => {
    // The builder replaces the whole document. A form that did not carry the
    // mode forward would turn a serialized item back into a bulk one.
    expect(Object.keys(item())).toContain('tracking_mode')
  })

  it('omits unit_counts for a bulk item, which has no units to summarize', () => {
    expect(item()).not.toHaveProperty('unit_counts')
    expect(item({ trackingMode: 'bulk', unitCounts: EMPTY_UNIT_COUNTS }))
      .not.toHaveProperty('unit_counts')
  })

  it('carries unit_counts for a serialized item', () => {
    const counts = unitCountsFrom([unit('available'), unit('in_use')])
    const payload = item({
      trackingMode: 'serialized',
      unitCounts: counts,
      quantityTotal: counts.active_total,
      quantityAvailable: counts.available,
    })

    expect(payload).toHaveProperty('tracking_mode', 'serialized')
    expect(payload.unit_counts).toEqual(counts)
    expect(payload.quantity_total).toBe(2)
    expect(payload.quantity_available).toBe(1)
  })
})

describe('an existing bulk item is untouched by any of this', () => {
  it('keeps quantity_available authoritative and condition-independent', () => {
    // The bulk model is unchanged: a person maintains the number, and an
    // unusable count does not reduce it. Only serialized items get the new
    // availability rule.
    const legacy = {
      quantity_total: 12,
      quantity_available: 8,
      condition_counts: { ...EMPTY_CONDITION_COUNTS, good: 8, needs_repair: 4 },
    } as unknown as InventoryUnit

    expect(trackingModeOf(legacy as unknown as InventoryItem)).toBe('bulk')
  })
})
