import { describe, expect, it } from 'vitest'
import {
  EMPTY_MIRRORS,
  MAX_BULK_UNITS,
  PROMOTION_STATUSES,
  bucketOf,
  buildPromotionDrafts,
  generateAssetCodes,
  mirrorsOf,
  padWidthFor,
  planBulkGeneration,
  promotionMaintenanceBlock,
  promotionOutcome,
  unclassifiedDraftCount,
  draftsMissingUsingTeam,
  validatePromotion,
  withConditionChanged,
  withUnitAdded,
  withUnitsAdded,
  type PromotionDraft,
  type ResolvedPromotionDraft,
} from '@/domain/inventory-unit'
import {
  EMPTY_CONDITION_COUNTS, EMPTY_UNIT_COUNTS, conditionCountsTotal, unitCountsValid,
} from '@/domain/inventory'
import { isOpenStatus } from '@/domain/maintenance'
import type { ConditionCounts, InventoryItem, UnitCounts } from '@/types/inventory'
import { MAINTENANCE_STATUSES, type MaintenanceStatus } from '@/types/maintenance'

/**
 * Both halves of the stored invariant: the unit buckets add up, and the
 * condition breakdown accounts for exactly the non-retired units.
 */
function mirrorsConsistent(mirrors: {
  unit_counts: UnitCounts
  condition_counts: ConditionCounts
}): boolean {
  return unitCountsValid(mirrors.unit_counts)
    && conditionCountsTotal(mirrors.condition_counts) === mirrors.unit_counts.active_total
}

function counts(overrides: Partial<ConditionCounts> = {}): ConditionCounts {
  return { ...EMPTY_CONDITION_COUNTS, ...overrides }
}

function item(overrides: Partial<InventoryItem> = {}): InventoryItem {
  return {
    quantity_total: 0,
    quantity_available: 0,
    condition_counts: counts(),
    location: 'Shelf A',
    team_id: 'team-lighting',
    ...overrides,
  } as InventoryItem
}

describe('bucketOf', () => {
  it('counts an available unit in good repair as available', () => {
    expect(bucketOf({ status: 'available', condition: 'good' })).toBe('available')
  })

  it('counts a needs_repair unit on the shelf as available', () => {
    expect(bucketOf({ status: 'available', condition: 'needs_repair' })).toBe('available')
  })

  it('does not count an unusable unit as available even though it is on the shelf', () => {
    expect(bucketOf({ status: 'available', condition: 'unusable' })).toBe('unusable_on_hand')
  })

  it('counts an unusable unit that is out as in_use, not unusable_on_hand', () => {
    expect(bucketOf({ status: 'in_use', condition: 'unusable' })).toBe('in_use')
  })

  it('excludes retired units entirely', () => {
    expect(bucketOf({ status: 'retired', condition: 'good' })).toBeNull()
  })

  it.each(['in_use', 'in_maintenance', 'lost'] as const)('maps %s to its own bucket', (status) => {
    expect(bucketOf({ status, condition: 'good' })).toBe(status)
  })
})

describe('mirrorsOf', () => {
  it('reads stored unit counts when the item has them', () => {
    const unitCounts: UnitCounts = {
      ...EMPTY_UNIT_COUNTS, available: 3, in_use: 1, active_total: 4,
    }
    expect(mirrorsOf({ unit_counts: unitCounts, condition_counts: counts({ good: 4 }) }).unit_counts)
      .toEqual(unitCounts)
  })

  it('starts from empty when the item has never been serialized', () => {
    expect(mirrorsOf({ condition_counts: counts({ good: 9 }) }).unit_counts).toEqual(EMPTY_UNIT_COUNTS)
  })
})

describe('withUnitAdded', () => {
  it('raises every total a new available unit belongs to', () => {
    const next = withUnitAdded(EMPTY_MIRRORS, { status: 'available', condition: 'good' })

    expect(next.unit_counts.available).toBe(1)
    expect(next.unit_counts.active_total).toBe(1)
    expect(next.unit_counts.retired).toBe(0)
    expect(next.condition_counts.good).toBe(1)
    expect(next.quantity_total).toBe(1)
    expect(next.quantity_available).toBe(1)
  })

  it('adds an unusable unit to stock but not to availability', () => {
    const next = withUnitAdded(EMPTY_MIRRORS, { status: 'available', condition: 'unusable' })

    expect(next.unit_counts.available).toBe(0)
    expect(next.unit_counts.unusable_on_hand).toBe(1)
    expect(next.unit_counts.active_total).toBe(1)
    expect(next.quantity_available).toBe(0)
    expect(next.quantity_total).toBe(1)
  })

  it('counts a lost unit in the total, per the product decision', () => {
    const next = withUnitAdded(EMPTY_MIRRORS, { status: 'lost', condition: 'good' })

    expect(next.unit_counts.lost).toBe(1)
    expect(next.unit_counts.active_total).toBe(1)
    expect(next.quantity_total).toBe(1)
  })

  it('keeps a retired unit out of every active total but inside the lifetime total', () => {
    const next = withUnitAdded(EMPTY_MIRRORS, { status: 'retired', condition: 'unusable' })

    expect(next.unit_counts.active_total).toBe(0)
    expect(next.unit_counts.retired).toBe(1)
    expect(next.condition_counts.unusable).toBe(0)
    expect(next.quantity_total).toBe(0)
  })

  it('leaves the counts internally consistent for any single unit', () => {
    for (const status of ['available', 'in_use', 'in_maintenance', 'lost', 'retired'] as const) {
      for (const condition of ['excellent', 'good', 'fair', 'needs_repair', 'unusable'] as const) {
        const next = withUnitAdded(EMPTY_MIRRORS, { status, condition })
        expect(mirrorsConsistent(next)).toBe(true)
      }
    }
  })
})

describe('withUnitsAdded', () => {
  it('accumulates a mixed batch', () => {
    const next = withUnitsAdded(EMPTY_MIRRORS, [
      { status: 'available', condition: 'good' },
      { status: 'available', condition: 'good' },
      { status: 'available', condition: 'unusable' },
      { status: 'in_use', condition: 'fair' },
      { status: 'retired', condition: 'unusable' },
    ])

    expect(next.unit_counts).toMatchObject({
      available: 2, unusable_on_hand: 1, in_use: 1, active_total: 4, retired: 1,
    })
    expect(next.condition_counts).toEqual(counts({ good: 2, fair: 1, unusable: 1 }))
    expect(mirrorsConsistent(next)).toBe(true)
  })

  it('is the same as adding one at a time', () => {
    const batch = [
      { status: 'in_maintenance', condition: 'needs_repair' },
      { status: 'lost', condition: 'excellent' },
    ] as const

    const stepwise = batch.reduce(withUnitAdded, EMPTY_MIRRORS)
    expect(withUnitsAdded(EMPTY_MIRRORS, batch)).toEqual(stepwise)
  })
})

describe('withConditionChanged', () => {
  const base = withUnitsAdded(EMPTY_MIRRORS, [
    { status: 'available', condition: 'good' },
    { status: 'available', condition: 'unusable' },
    { status: 'in_use', condition: 'good' },
  ])

  it('moves the condition buckets without touching availability when no line is crossed', () => {
    const next = withConditionChanged(base, { status: 'available', from: 'good', to: 'fair' })

    expect(next.condition_counts).toEqual(counts({ fair: 1, unusable: 1, good: 1 }))
    expect(next.unit_counts.available).toBe(base.unit_counts.available)
    expect(next.unit_counts.unusable_on_hand).toBe(base.unit_counts.unusable_on_hand)
  })

  it('takes an on-shelf unit out of availability when it becomes unusable', () => {
    const next = withConditionChanged(base, { status: 'available', from: 'good', to: 'unusable' })

    expect(next.unit_counts.available).toBe(base.unit_counts.available - 1)
    expect(next.unit_counts.unusable_on_hand).toBe(base.unit_counts.unusable_on_hand + 1)
    expect(next.quantity_available).toBe(base.quantity_available - 1)
    expect(next.unit_counts.active_total).toBe(base.unit_counts.active_total)
  })

  it('returns a repaired on-shelf unit to availability', () => {
    const next = withConditionChanged(base, { status: 'available', from: 'unusable', to: 'fair' })

    expect(next.unit_counts.available).toBe(base.unit_counts.available + 1)
    expect(next.unit_counts.unusable_on_hand).toBe(base.unit_counts.unusable_on_hand - 1)
  })

  it('leaves availability alone when the unit is not on the shelf', () => {
    const next = withConditionChanged(base, { status: 'in_use', from: 'good', to: 'unusable' })

    expect(next.unit_counts.available).toBe(base.unit_counts.available)
    expect(next.unit_counts.unusable_on_hand).toBe(base.unit_counts.unusable_on_hand)
    expect(next.unit_counts.in_use).toBe(base.unit_counts.in_use)
    expect(next.condition_counts.unusable).toBe(base.condition_counts.unusable + 1)
  })

  it('is a no-op when the condition did not actually change', () => {
    expect(withConditionChanged(base, { status: 'available', from: 'good', to: 'good' })).toEqual(base)
  })

  it('does not change a retired unit, which is in no bucket', () => {
    const next = withConditionChanged(base, { status: 'retired', from: 'good', to: 'unusable' })
    expect(next).toEqual(base)
  })

  it('keeps the counts consistent across a boundary crossing', () => {
    const next = withConditionChanged(base, { status: 'available', from: 'good', to: 'unusable' })
    expect(mirrorsConsistent(next)).toBe(true)
  })
})

describe('generateAssetCodes', () => {
  it('numbers from the start value with the prefix', () => {
    expect(generateAssetCodes({ prefix: 'CLAMP', start: 1, count: 3 }))
      .toEqual(['CLAMP-001', 'CLAMP-002', 'CLAMP-003'])
  })

  it('widens the padding so the largest number still fits', () => {
    const codes = generateAssetCodes({ prefix: 'MIC', start: 998, count: 5 })
    expect(codes[0]).toBe('MIC-0998')
    expect(codes[4]).toBe('MIC-1002')
  })

  it('pads to three digits at minimum', () => {
    expect(padWidthFor(1, 9)).toBe(3)
    expect(padWidthFor(1, 1000)).toBe(4)
  })

  it('omits the separator when no prefix was given', () => {
    expect(generateAssetCodes({ prefix: '  ', start: 7, count: 1 })).toEqual(['007'])
  })
})

describe('planBulkGeneration', () => {
  it('reports which generated codes are already in use', () => {
    const result = planBulkGeneration({
      prefix: 'DMX', start: 1, count: 3, existingCodes: ['dmx-002'],
    })

    expect(result).toMatchObject({ valid: true, duplicates: ['DMX-002'] })
  })

  it('accepts a run with no collisions', () => {
    const result = planBulkGeneration({
      prefix: 'DMX', start: 1, count: 2, existingCodes: ['XLR-001'],
    })

    expect(result).toEqual({ valid: true, codes: ['DMX-001', 'DMX-002'], duplicates: [] })
  })

  it('refuses a batch of zero', () => {
    expect(planBulkGeneration({ prefix: 'A', start: 1, count: 0, existingCodes: [] }).valid)
      .toBe(false)
  })

  it('refuses more than the batch ceiling', () => {
    const result = planBulkGeneration({
      prefix: 'A', start: 1, count: MAX_BULK_UNITS + 1, existingCodes: [],
    })
    expect(result.valid).toBe(false)
  })

  it('refuses a fractional or negative start', () => {
    expect(planBulkGeneration({ prefix: 'A', start: -1, count: 2, existingCodes: [] }).valid)
      .toBe(false)
    expect(planBulkGeneration({ prefix: 'A', start: 1.5, count: 2, existingCodes: [] }).valid)
      .toBe(false)
  })
})

describe('buildPromotionDrafts', () => {
  it('creates one draft per recorded unit, all starting available', () => {
    const drafts = buildPromotionDrafts({
      item: item({ quantity_total: 3, condition_counts: counts({ good: 2, fair: 1 }) }),
      prefix: 'C',
      start: 1,
    })

    expect(drafts).toHaveLength(3)
    expect(drafts.every((draft) => draft.status === 'available')).toBe(true)
    expect(drafts.map((draft) => draft.condition).sort()).toEqual(['fair', 'good', 'good'])
  })

  it('does not guess that unavailable stock is in use', () => {
    const drafts = buildPromotionDrafts({
      item: item({ quantity_total: 12, quantity_available: 8, condition_counts: counts({ good: 12 }) }),
      prefix: 'C',
      start: 1,
    })

    expect(drafts.filter((draft) => draft.status !== 'available')).toHaveLength(0)
  })

  it('never assigns a borrowing team by itself', () => {
    const drafts = buildPromotionDrafts({
      item: item({ quantity_total: 2, condition_counts: counts({ good: 2 }) }),
      prefix: 'C',
      start: 1,
    })

    expect(drafts.every((draft) => (draft.usingTeamId ?? null) === null)).toBe(true)
  })

  it('leaves a unit the aggregate never classified as null, rather than guessing', () => {
    const drafts = buildPromotionDrafts({
      item: item({ quantity_total: 4, condition_counts: counts({ excellent: 1 }) }),
      prefix: 'C',
      start: 1,
    })

    expect(drafts.map((draft) => draft.condition)).toEqual(['excellent', null, null, null])
  })

  it('reports how many units are left unclassified', () => {
    // The worked example: ten recorded, eight classified, two unaccounted for.
    const drafts = buildPromotionDrafts({
      item: item({
        quantity_total: 10,
        condition_counts: counts({ excellent: 2, good: 3, fair: 2, needs_repair: 1 }),
      }),
      prefix: 'C',
      start: 1,
    })

    expect(drafts).toHaveLength(10)
    expect(unclassifiedDraftCount(drafts)).toBe(2)
  })

  it('leaves nothing unclassified when the counts already cover the total', () => {
    const drafts = buildPromotionDrafts({
      item: item({ quantity_total: 3, condition_counts: counts({ good: 3 }) }),
      prefix: 'C',
      start: 1,
    })

    expect(unclassifiedDraftCount(drafts)).toBe(0)
  })

  it('defaults each unit to the item location and honours an override', () => {
    const fromItem = buildPromotionDrafts({
      item: item({ quantity_total: 1, location: 'Loft' }), prefix: 'C', start: 1,
    })
    expect(fromItem[0]?.storageLocation).toBe('Loft')

    const overridden = buildPromotionDrafts({
      item: item({ quantity_total: 1, location: 'Loft' }),
      prefix: 'C',
      start: 1,
      storageLocation: 'Dimmer rack',
    })
    expect(overridden[0]?.storageLocation).toBe('Dimmer rack')
  })
})

describe('PROMOTION_STATUSES', () => {
  it('offers only the states a conversion can honestly describe', () => {
    expect([...PROMOTION_STATUSES]).toEqual(['available', 'in_use', 'lost'])
  })

  it('excludes maintenance, which needs a repair record this phase cannot create', () => {
    expect(PROMOTION_STATUSES).not.toContain('in_maintenance')
  })
})

describe('draftsMissingUsingTeam', () => {
  const base: PromotionDraft = {
    assetCode: 'C-001', condition: 'good', status: 'available', storageLocation: 'Shelf A',
    owningTeamId: 'team-lighting',
  }

  it('counts an in-use draft with no team', () => {
    expect(draftsMissingUsingTeam([{ ...base, status: 'in_use' }])).toBe(1)
  })

  it('counts an in-use draft whose team is blank', () => {
    expect(draftsMissingUsingTeam([{ ...base, status: 'in_use', usingTeamId: '  ' }])).toBe(1)
  })

  it('does not count an in-use draft that names a team', () => {
    expect(draftsMissingUsingTeam([{ ...base, status: 'in_use', usingTeamId: 'team-a' }])).toBe(0)
  })

  it('ignores a team on a draft that is not in use', () => {
    expect(draftsMissingUsingTeam([base])).toBe(0)
  })
})

describe('promotionOutcome', () => {
  function draft(overrides: Partial<ResolvedPromotionDraft> = {}): ResolvedPromotionDraft {
    return {
      assetCode: 'C-001', condition: 'good', status: 'available', storageLocation: 'Shelf A',
      owningTeamId: 'team-lighting',
      ...overrides,
    }
  }

  it('reports no change when the reviewed drafts match the old availability', () => {
    const outcome = promotionOutcome({
      item: item({ quantity_available: 2 }),
      drafts: [draft(), draft({ assetCode: 'C-002' })],
    })

    expect(outcome).toMatchObject({ previousAvailable: 2, nextAvailable: 2, changed: false })
  })

  it('flags the drop when the reviewer marks units as out', () => {
    const outcome = promotionOutcome({
      item: item({ quantity_available: 2 }),
      drafts: [draft(), draft({ assetCode: 'C-002', status: 'in_use', usingTeamId: 'team-a' })],
    })

    expect(outcome).toMatchObject({ previousAvailable: 2, nextAvailable: 1, changed: true })
  })

  it('flags the drop caused by unusable stock no longer counting as available', () => {
    const outcome = promotionOutcome({
      item: item({ quantity_available: 2 }),
      drafts: [draft(), draft({ assetCode: 'C-002', condition: 'unusable' })],
    })

    expect(outcome).toMatchObject({ nextAvailable: 1, changed: true })
    expect(outcome.mirrors.unit_counts.unusable_on_hand).toBe(1)
  })

  it('produces mirrors that satisfy the stored invariant', () => {
    const outcome = promotionOutcome({
      item: item({ quantity_available: 3 }),
      drafts: [
        draft(),
        draft({ assetCode: 'C-002', status: 'in_maintenance', condition: 'needs_repair' }),
        draft({ assetCode: 'C-003', condition: 'unusable' }),
      ],
    })

    expect(mirrorsConsistent(outcome.mirrors)).toBe(true)
  })
})

describe('validatePromotion', () => {
  const TEAMS = ['team-lighting', 'team-costume']

  function draft(overrides: Partial<PromotionDraft> = {}): PromotionDraft {
    return {
      assetCode: 'C-001', condition: 'good', status: 'available', storageLocation: 'Shelf A',
      owningTeamId: 'team-lighting',
      ...overrides,
    }
  }

  it('accepts one fully classified draft per recorded unit', () => {
    const result = validatePromotion({
      item: item({ quantity_total: 1 }), drafts: [draft()], teamIds: TEAMS,
    })

    expect(result.valid).toBe(true)
  })

  it('hands back drafts the caller can write without further checks', () => {
    const result = validatePromotion({
      item: item({ quantity_total: 1 }), drafts: [draft()], teamIds: TEAMS,
    })

    expect(result.valid ? result.drafts : []).toHaveLength(1)
  })

  it('refuses an item with nothing to convert', () => {
    expect(validatePromotion({ item: item({ quantity_total: 0 }), drafts: [], teamIds: TEAMS }).valid)
      .toBe(false)
  })

  it('refuses a draft count that disagrees with the recorded total', () => {
    expect(validatePromotion({
      item: item({ quantity_total: 2 }), drafts: [draft()], teamIds: TEAMS,
    }).valid).toBe(false)
  })

  it('blocks conversion while one unit is unclassified', () => {
    const result = validatePromotion({
      item: item({ quantity_total: 2 }),
      drafts: [draft(), draft({ assetCode: 'C-002', condition: null })],
      teamIds: TEAMS,
    })

    expect(result.valid).toBe(false)
    expect(result.valid ? '' : result.message).toContain('1 unit does not have an existing condition')
  })

  it('blocks conversion while several units are unclassified', () => {
    const result = validatePromotion({
      item: item({ quantity_total: 3 }),
      drafts: [
        draft(),
        draft({ assetCode: 'C-002', condition: null }),
        draft({ assetCode: 'C-003', condition: null }),
      ],
      teamIds: TEAMS,
    })

    expect(result.valid).toBe(false)
    expect(result.valid ? '' : result.message).toContain('2 units do not have an existing condition')
  })

  it('allows conversion once every unclassified unit has been assigned', () => {
    const result = validatePromotion({
      item: item({ quantity_total: 2 }),
      drafts: [draft(), draft({ assetCode: 'C-002', condition: 'fair' })],
      teamIds: TEAMS,
    })

    expect(result.valid).toBe(true)
  })

  it('refuses an in-use unit that names no borrowing team', () => {
    const result = validatePromotion({
      item: item({ quantity_total: 1 }),
      drafts: [draft({ status: 'in_use' })],
      teamIds: TEAMS,
    })

    expect(result.valid).toBe(false)
    expect(result.valid ? '' : result.message).toContain('which team has it')
  })

  it('refuses an in-use unit whose team is blank', () => {
    expect(validatePromotion({
      item: item({ quantity_total: 1 }),
      drafts: [draft({ status: 'in_use', usingTeamId: '   ' })],
      teamIds: TEAMS,
    }).valid).toBe(false)
  })

  it('refuses a borrowing team that does not belong to the organization', () => {
    const result = validatePromotion({
      item: item({ quantity_total: 1 }),
      drafts: [draft({ status: 'in_use', usingTeamId: 'team-from-elsewhere' })],
      teamIds: TEAMS,
    })

    expect(result.valid).toBe(false)
    expect(result.valid ? '' : result.message).toContain('does not belong to this organization')
  })

  it('accepts an in-use unit that names a real team', () => {
    expect(validatePromotion({
      item: item({ quantity_total: 1 }),
      drafts: [draft({ status: 'in_use', usingTeamId: 'team-costume' })],
      teamIds: TEAMS,
    }).valid).toBe(true)
  })

  it('refuses a unit initialized into maintenance', () => {
    // A unit in maintenance is half a record; the repair that explains it is the
    // other half, and this conversion has no way to create one.
    const result = validatePromotion({
      item: item({ quantity_total: 1 }),
      drafts: [draft({ status: 'in_maintenance' })],
      teamIds: TEAMS,
    })

    expect(result.valid).toBe(false)
    expect(result.valid ? '' : result.message).toContain('available, in use, or lost')
  })

  it('refuses a unit initialized as retired', () => {
    expect(validatePromotion({
      item: item({ quantity_total: 1 }),
      drafts: [draft({ status: 'retired' })],
      teamIds: TEAMS,
    }).valid).toBe(false)
  })

  it('accepts a unit initialized as lost', () => {
    expect(validatePromotion({
      item: item({ quantity_total: 1 }),
      drafts: [draft({ status: 'lost' })],
      teamIds: TEAMS,
    }).valid).toBe(true)
  })

  it('refuses two units sharing an asset code', () => {
    expect(validatePromotion({
      item: item({ quantity_total: 2 }),
      drafts: [draft(), draft()],
      teamIds: TEAMS,
    }).valid).toBe(false)
  })
})

describe('the converted summary matches the unit set exactly', () => {
  it('counts every classified unit and nothing more', () => {
    // Ten recorded with two unclassified: the user assigns them, and the
    // resulting condition breakdown accounts for all ten.
    const drafts = buildPromotionDrafts({
      item: item({
        quantity_total: 10,
        condition_counts: counts({ excellent: 2, good: 3, fair: 2, needs_repair: 1 }),
      }),
      prefix: 'C',
      start: 1,
    })

    const assigned = drafts.map(
      (draft) => (draft.condition === null ? { ...draft, condition: 'fair' as const } : draft),
    )
    const result = validatePromotion({
      item: item({ quantity_total: 10 }), drafts: assigned, teamIds: ['team-lighting'],
    })
    expect(result.valid).toBe(true)

    const outcome = promotionOutcome({
      item: item({ quantity_available: 10 }),
      drafts: result.valid ? result.drafts : [],
    })

    expect(outcome.mirrors.unit_counts.active_total).toBe(10)
    expect(conditionCountsTotal(outcome.mirrors.condition_counts))
      .toBe(outcome.mirrors.unit_counts.active_total)
    expect(outcome.mirrors.condition_counts)
      .toEqual(counts({ excellent: 2, good: 3, fair: 4, needs_repair: 1 }))
    expect(mirrorsConsistent(outcome.mirrors)).toBe(true)
  })
})

describe('promotionMaintenanceBlock', () => {
  function record(status: MaintenanceStatus, quantitySent = 4) {
    return { status, quantity_sent: quantitySent }
  }

  it('allows conversion when the item has no repair history at all', () => {
    expect(promotionMaintenanceBlock([])).toBeNull()
  })

  it('allows conversion when every repair was returned', () => {
    expect(promotionMaintenanceBlock([record('returned'), record('returned')])).toBeNull()
  })

  it('allows conversion when every repair was cancelled', () => {
    expect(promotionMaintenanceBlock([record('cancelled')])).toBeNull()
  })

  it('allows conversion on a mix of returned and cancelled history', () => {
    expect(promotionMaintenanceBlock([record('returned'), record('cancelled')])).toBeNull()
  })

  it.each(['planned', 'sent', 'in_service', 'ready'] as const)(
    'blocks conversion while a repair is %s',
    (status) => {
      expect(promotionMaintenanceBlock([record(status)]))
        .toEqual({ openRecordCount: 1, unitsInMaintenance: 4 })
    },
  )

  it('blocks when one record among several is still open', () => {
    const block = promotionMaintenanceBlock([
      record('returned', 2),
      record('cancelled', 3),
      record('in_service', 4),
    ])

    expect(block).toEqual({ openRecordCount: 1, unitsInMaintenance: 4 })
  })

  it('counts every open record and the quantity they cover', () => {
    // The worked example: 24 clamps, four out for repair, plus a planned repair.
    const block = promotionMaintenanceBlock([
      record('in_service', 4),
      record('planned', 2),
      record('returned', 6),
    ])

    expect(block).toEqual({ openRecordCount: 2, unitsInMaintenance: 6 })
  })

  it('uses the same open/closed line as the rest of the application', () => {
    // Whatever counts as unfinished elsewhere counts as blocking here; the two
    // are the same helper rather than two lists that could drift apart.
    for (const status of MAINTENANCE_STATUSES) {
      expect(promotionMaintenanceBlock([record(status)]) !== null).toBe(isOpenStatus(status))
    }
  })
})

describe('unit ownership is per unit, not inherited', () => {
  it('defaults every promotion draft to the bulk item\'s team', () => {
    // Known information, not a guess: the bulk item really did belong to a crew.
    const drafts = buildPromotionDrafts({
      item: item({ quantity_total: 3, condition_counts: counts({ good: 3 }), team_id: 'team-scenic' }),
      prefix: 'C',
      start: 1,
    })

    expect(drafts.every((draft) => draft.owningTeamId === 'team-scenic')).toBe(true)
  })

  it('lets a conversion split one item between crews', () => {
    const drafts = buildPromotionDrafts({
      item: item({ quantity_total: 3, condition_counts: counts({ good: 3 }) }),
      prefix: 'C',
      start: 1,
    }).map((draft, index) => (
      index === 1 ? { ...draft, owningTeamId: 'team-scenic' } : draft
    ))

    const result = validatePromotion({
      item: item({ quantity_total: 3 }),
      drafts,
      teamIds: ['team-lighting', 'team-scenic'],
    })

    expect(result.valid).toBe(true)
    expect(result.valid ? result.drafts.map((draft) => draft.owningTeamId) : [])
      .toEqual(['team-lighting', 'team-scenic', 'team-lighting'])
  })

  it('refuses a draft owned by a team the actor cannot assign', () => {
    const drafts = buildPromotionDrafts({
      item: item({ quantity_total: 1, condition_counts: counts({ good: 1 }) }),
      prefix: 'C',
      start: 1,
    }).map((draft) => ({ ...draft, owningTeamId: 'team-not-mine' }))

    const result = validatePromotion({
      item: item({ quantity_total: 1 }), drafts, teamIds: ['team-lighting'],
    })

    expect(result.valid).toBe(false)
    expect(result.valid ? '' : result.message).toContain('owning team')
  })

  it('does not let the owning team affect the lifecycle counts', () => {
    // Ownership is not a lifecycle state; splitting an item between crews must
    // not move a single number in the summary.
    const oneTeam = promotionOutcome({
      item: item({ quantity_available: 2 }),
      drafts: [
        { assetCode: 'C-001', condition: 'good', status: 'available', storageLocation: 'A', owningTeamId: 'team-lighting' },
        { assetCode: 'C-002', condition: 'good', status: 'available', storageLocation: 'A', owningTeamId: 'team-lighting' },
      ],
    })
    const twoTeams = promotionOutcome({
      item: item({ quantity_available: 2 }),
      drafts: [
        { assetCode: 'C-001', condition: 'good', status: 'available', storageLocation: 'A', owningTeamId: 'team-lighting' },
        { assetCode: 'C-002', condition: 'good', status: 'available', storageLocation: 'A', owningTeamId: 'team-scenic' },
      ],
    })

    expect(twoTeams.mirrors).toEqual(oneTeam.mirrors)
  })
})
