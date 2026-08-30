import { describe, expect, it } from 'vitest'
import {
  MAX_CONTEXT_UNITS, buildInventoryContext, contextBlock, prioritizeUnitsForQuery, resolveRefs,
  serializeItem, serializeUnit, unitIntentsOf,
} from '@/features/ai/inventory-context'
import { EMPTY_CONDITION_COUNTS } from '@/domain/inventory'
import type { InventoryItem, InventoryUnit, UnitCounts } from '@/types/inventory'
import type { TheaterTeam } from '@/types/organization'

const TEAMS: TheaterTeam[] = [
  { team_id: 'team-sound', name: 'Sound' } as TheaterTeam,
  { team_id: 'team-lighting', name: 'Lighting' } as TheaterTeam,
]

function counts(overrides: Partial<UnitCounts> = {}): UnitCounts {
  return {
    active_total: 4, available: 2, unusable_on_hand: 0, in_use: 1,
    in_maintenance: 1, lost: 0, retired: 0,
    ...overrides,
  } as UnitCounts
}

function bulk(overrides: Partial<InventoryItem> = {}): InventoryItem {
  return {
    item_id: 'item-bulk',
    organization_id: 'org-a',
    name: 'XLR Cable',
    category: 'Cables',
    team_id: 'team-sound',
    tracking_mode: 'bulk',
    quantity_total: 12,
    quantity_available: 8,
    condition_counts: { ...EMPTY_CONDITION_COUNTS, good: 12 },
    location: 'Booth',
    ...overrides,
  } as InventoryItem
}

function serialized(overrides: Partial<InventoryItem> = {}): InventoryItem {
  return {
    ...bulk(),
    item_id: 'item-mic',
    name: 'Wireless Handheld',
    category: 'Microphones',
    tracking_mode: 'serialized',
    unit_counts: counts(),
    quantity_total: 4,
    quantity_available: 2,
    condition_counts: { ...EMPTY_CONDITION_COUNTS, good: 4 },
    ...overrides,
  } as InventoryItem
}

function unit(overrides: Partial<InventoryUnit> = {}): InventoryUnit {
  return {
    unit_id: 'u1',
    organization_id: 'org-a',
    inventory_item_id: 'item-mic',
    asset_code: 'MIC-017',
    team_id: 'team-sound',
    status: 'available',
    condition: 'good',
    storage_location: 'Booth shelf B',
    ...overrides,
  } as InventoryUnit
}

const line = (u: Partial<InventoryUnit> = {}, item = serialized()) =>
  serializeUnit('U1', unit(u), item, TEAMS)

describe('how a bulk item is described', () => {
  it('is named as a quantity, because that is what it is', () => {
    const text = serializeItem('I1', bulk(), TEAMS)

    expect(text).toContain('tracking bulk quantity')
    expect(text).toContain('total 12, available 8')
    expect(text).not.toContain('active total')
  })

  it('keeps its condition breakdown and location', () => {
    const text = serializeItem('I1', bulk(), TEAMS)
    expect(text).toContain('condition')
    expect(text).toContain('location Booth')
  })
})

describe('how a serialized item is described', () => {
  it('says its numbers are counted from individual equipment', () => {
    // The distinction that matters: the parent is a summary, and the model must
    // not describe four microphones as though they were one.
    const text = serializeItem('I1', serialized(), TEAMS)

    expect(text).toContain('tracking individual units')
    expect(text).toContain('available 2')
    expect(text).toContain('in use 1')
    expect(text).toContain('in maintenance 1')
    expect(text).toContain('active total 4')
  })

  it('names retired equipment only when there is some, and says it is not active', () => {
    expect(serializeItem('I1', serialized(), TEAMS)).not.toContain('retired')

    const withRetired = serializeItem('I1', serialized({
      unit_counts: counts({ retired: 3 }),
    }), TEAMS)
    expect(withRetired).toContain('retired 3 (not active)')
  })
})

describe('how one piece of equipment is described', () => {
  it('leads with its asset code, which is how people refer to it', () => {
    expect(line()).toContain('asset code MIC-017')
    expect(line()).toContain('Wireless Handheld')
  })

  it('states availability rather than leaving it to be worked out', () => {
    expect(line({ status: 'available', condition: 'good' })).toContain('available yes')
    expect(line({ status: 'in_use' })).toContain('available no')
    expect(line({ status: 'in_maintenance' })).toContain('available no')
    expect(line({ status: 'lost' })).toContain('available no')
    expect(line({ status: 'retired' })).toContain('available no')
  })

  it('keeps equipment that needs repair available, because it is still on the shelf', () => {
    // The trap this exists for: "needs repair" is not "unavailable".
    const text = line({ status: 'available', condition: 'needs_repair' })
    expect(text).toContain('condition needs_repair')
    expect(text).toContain('available yes')
  })

  it('marks unusable equipment unavailable even though it is on the shelf', () => {
    const text = line({ status: 'available', condition: 'unusable' })
    expect(text).toContain('available no')
  })

  it('says who has equipment that is out', () => {
    expect(line({ status: 'in_use', using_team_id: 'team-lighting' }))
      .toContain('checked out to team Lighting')
  })

  it('separates a planned repair from an actual one', () => {
    // A plan is an intention; the equipment has not moved. Merging the two
    // would have the model reporting available microphones as away for repair.
    const planned = line({
      status: 'available', planned_maintenance_record_id: 'plan-1',
    } as Partial<InventoryUnit>)
    expect(planned).toContain('planned maintenance scheduled (advisory, not yet away)')
    expect(planned).not.toContain('currently away for repair')
    expect(planned).toContain('available yes')

    const away = line({
      status: 'in_maintenance', current_maintenance_record_id: 'rec-1',
    } as Partial<InventoryUnit>)
    expect(away).toContain('currently away for repair')
    expect(away).not.toContain('planned maintenance scheduled')
  })

  it('can say both when a unit that is out also has a plan', () => {
    const both = line({
      status: 'in_use',
      using_team_id: 'team-lighting',
      planned_maintenance_record_id: 'plan-1',
    } as Partial<InventoryUnit>)

    expect(both).toContain('checked out to team Lighting')
    expect(both).toContain('planned maintenance scheduled')
  })

  it('mentions past repairs without listing them', () => {
    expect(line({ maintenance_record_ids: ['r1', 'r2'] } as Partial<InventoryUnit>))
      .toContain('past repairs 2')
    expect(line()).not.toContain('past repairs')
  })

  it('never carries a document id', () => {
    const text = line({ unit_id: 'unitSECRETAAAAAAAAAA' })
    expect(text).not.toContain('unitSECRET')
    expect(text).not.toContain('item-mic')
  })
})

describe('what an item says about cost', () => {
  it('reports a stored planning estimate', () => {
    expect(serializeItem('I1', bulk({ unit_cost_cents: 1850 }), TEAMS))
      .toContain('estimated unit cost $18.50')
  })

  it('says unknown when nobody has recorded one, never zero', () => {
    // The model must never fill this in, and must never read it as free.
    const text = serializeItem('I1', bulk(), TEAMS)
    expect(text).toContain('estimated unit cost unknown')
    expect(text).not.toContain('$0.00')
  })

  it('reports a deliberate zero as zero', () => {
    expect(serializeItem('I1', bulk({ unit_cost_cents: 0 }), TEAMS))
      .toContain('estimated unit cost $0.00')
  })
})

describe('building a context for a mixed organization', () => {
  const items = [bulk(), serialized()]
  const units = [
    unit({ unit_id: 'u1', asset_code: 'MIC-017' }),
    unit({ unit_id: 'u2', asset_code: 'MIC-018', status: 'in_use' }),
  ]

  it('gives items and equipment separate reference spaces', () => {
    const context = buildInventoryContext({ items, units, teams: TEAMS })

    expect([...context.byRef.keys()]).toEqual(['I1', 'I2'])
    expect([...context.unitsByRef.keys()]).toEqual(['U1', 'U2'])
    expect(context.totalAccessible).toBe(2)
    expect(context.totalUnitsAccessible).toBe(2)
  })

  it('works for an organization with no serialized equipment at all', () => {
    const context = buildInventoryContext({ items: [bulk()], teams: TEAMS })

    expect(context.unitLines).toEqual([])
    expect(context.totalUnitsAccessible).toBe(0)
    expect(contextBlock(context)).not.toContain('EQUIPMENT')
  })

  it('tells the model the equipment block is the authoritative one', () => {
    const block = contextBlock(buildInventoryContext({ items, units, teams: TEAMS }))

    expect(block).toContain('EQUIPMENT_DATA')
    expect(block).toContain('authoritative record')
    expect(block).toContain('only summarizes them')
  })

  it('says nothing at all when there is nothing to say', () => {
    const block = contextBlock(buildInventoryContext({ items: [], teams: TEAMS }))
    expect(block).toContain('none supplied')
    expect(block).toContain('Do not state anything')
  })
})

describe('when there is more equipment than one request can carry', () => {
  const many = Array.from({ length: MAX_CONTEXT_UNITS + 25 }, (_, index) => unit({
    unit_id: `u${String(index)}`,
    asset_code: `MIC-${String(index).padStart(3, '0')}`,
  }))

  it('carries the cap and reports what it left out', () => {
    const context = buildInventoryContext({
      items: [serialized()], units: many, teams: TEAMS, query: 'anything',
    })

    expect(context.unitLines).toHaveLength(MAX_CONTEXT_UNITS)
    expect(context.omittedUnitCount).toBe(25)
    expect(contextBlock(context)).toContain('do not claim the')
  })

  it('puts the equipment the question is about first', () => {
    const context = buildInventoryContext({
      items: [serialized()], units: many, teams: TEAMS, query: 'where is MIC-215',
    })

    expect(context.unitLines[0]).toContain('MIC-215')
  })
})

describe('finding equipment by what the question mentions', () => {
  const itemsById = new Map([[serialized().item_id, serialized()]])
  const units = [
    unit({ unit_id: 'u1', asset_code: 'MIC-017' }),
    unit({ unit_id: 'u2', asset_code: 'LIGHT-004', storage_location: 'Catwalk' }),
    unit({ unit_id: 'u3', asset_code: 'CABLE-023', status: 'lost' }),
  ]

  const first = (query: string) =>
    prioritizeUnitsForQuery(units, query, itemsById)[0]?.asset_code

  it('matches an asset code, which is the question this exists for', () => {
    expect(first('where is MIC-017')).toBe('MIC-017')
    expect(first('LIGHT-004')).toBe('LIGHT-004')
  })

  it('matches a short code fragment that prose matching would drop', () => {
    expect(first('017')).toBe('MIC-017')
  })

  it('matches where equipment is kept', () => {
    expect(first('what is on the catwalk')).toBe('LIGHT-004')
  })

  it('matches a lifecycle state', () => {
    expect(first('which equipment is lost')).toBe('CABLE-023')
  })

  it('leaves the order alone when the question says nothing useful', () => {
    expect(prioritizeUnitsForQuery(units, 'a', itemsById).map((u) => u.asset_code))
      .toEqual(['MIC-017', 'LIGHT-004', 'CABLE-023'])
  })
})

describe('turning what the model said back into records', () => {
  const items = [bulk(), serialized()]
  const units = [unit({ unit_id: 'u1' }), unit({ unit_id: 'u2', asset_code: 'MIC-018' })]
  const context = buildInventoryContext({ items, units, teams: TEAMS })

  it('resolves both kinds of reference', () => {
    const resolved = resolveRefs(['I2', 'U1'], context)

    expect(resolved.items.map((i) => i.item_id)).toEqual(['item-mic'])
    expect(resolved.units.map((u) => u.unit_id)).toEqual(['u1'])
    expect(resolved.unknown).toEqual([])
  })

  it('discards a reference that was never supplied', () => {
    // The check that makes the arrangement safe: a model that invents U99 or
    // echoes a Firestore id produces nothing extra.
    const resolved = resolveRefs(['U99', 'I50', 'unitSECRETAAAAAAAAAA'], context)

    expect(resolved.items).toEqual([])
    expect(resolved.units).toEqual([])
    expect(resolved.unknown).toHaveLength(3)
  })

  it('lists a repeated reference once', () => {
    const resolved = resolveRefs(['U1', 'U1', 'U1'], context)

    expect(resolved.units).toHaveLength(1)
    expect(resolved.duplicates).toEqual(['U1'])
  })

  it('is not confused by case or whitespace', () => {
    expect(resolveRefs([' u1 ', 'i1'], context).units).toHaveLength(1)
    expect(resolveRefs([' u1 ', 'i1'], context).items).toHaveLength(1)
  })
})

describe('a question about a state, in an organization too big to send whole', () => {
  /**
   * The gap the live failure exposed as a possibility.
   *
   * Equipment with a repair planned is usually sitting on the shelf with status
   * `available`. Ranking by text alone would score it against words like
   * "planned" and "maintenance" that appear nowhere in its asset code, name, or
   * status — so past the cap, the very equipment the question is about would be
   * ranked last and cut.
   */
  const many = Array.from({ length: MAX_CONTEXT_UNITS + 40 }, (_, index) => unit({
    unit_id: `u${String(index)}`,
    asset_code: `CLAMP-${String(index).padStart(3, '0')}`,
  }))

  const planned = unit({
    unit_id: 'planned-1', asset_code: 'MIC-090', status: 'available',
    planned_maintenance_record_id: 'plan-1',
  } as Partial<InventoryUnit>)

  const away = unit({
    unit_id: 'away-1', asset_code: 'MIC-091', status: 'in_maintenance',
    current_maintenance_record_id: 'rec-1',
  } as Partial<InventoryUnit>)

  const lost = unit({ unit_id: 'lost-1', asset_code: 'MIC-092', status: 'lost' })

  /** The needles are put last, where a cap would drop them. */
  function haystack(...needles: InventoryUnit[]) {
    return [...many, ...needles]
  }

  function sent(query: string, ...needles: InventoryUnit[]) {
    const context = buildInventoryContext({
      items: [serialized()], units: haystack(...needles), teams: TEAMS, query,
    })
    return context.unitLines.join('\n')
  }

  it('keeps planned equipment for a planned-maintenance question', () => {
    const block = sent('Do we have any equipment with planned maintenance?', planned)

    expect(block).toContain('MIC-090')
    expect(block).toContain('planned maintenance scheduled')
  })

  it('keeps equipment that is away for an in-maintenance question', () => {
    expect(sent('what is in maintenance right now', away)).toContain('MIC-091')
  })

  it('keeps both for a bare question about repairs, rather than guessing', () => {
    const block = sent('anything to do with repair', planned, away)

    expect(block).toContain('MIC-090')
    expect(block).toContain('MIC-091')
  })

  it('keeps lost equipment for a question about missing equipment', () => {
    expect(sent('what equipment is missing', lost)).toContain('MIC-092')
  })

  it('still finds one piece by its asset code', () => {
    // The intent rules must not displace the lookup they were added beside.
    expect(sent('where is CLAMP-215')).toContain('CLAMP-215')
  })

  it('ranks the equipment that answers the question above the rest', () => {
    // Ranking is what the cap consumes, so it is checked on the selector
    // itself: below the cap nothing is reordered, because nothing is dropped.
    const ordered = prioritizeUnitsForQuery(
      [away, planned],
      'Do we have any equipment with planned maintenance?',
      new Map([[serialized().item_id, serialized()]]),
    )

    expect(ordered[0]?.asset_code).toBe('MIC-090')
  })

  it('recognises the intent behind the wording, not the wording itself', () => {
    const plannedIntent = unitIntentsOf('anything scheduled for maintenance?')
    expect(plannedIntent).toHaveLength(1)
    expect(plannedIntent[0]?.(planned)).toBe(true)
    expect(plannedIntent[0]?.(away)).toBe(false)

    // A question about nothing in particular claims no intent at all.
    expect(unitIntentsOf('where is CLAMP-014')).toEqual([])
  })
})

describe('an organization small enough to send whole', () => {
  it('sends every unit, whatever the question was', () => {
    // The cap is the only thing that drops anything. Below it, no question can
    // starve the model of a record.
    const units = [
      unit({ unit_id: 'u1', asset_code: 'MIC-001' }),
      unit({
        unit_id: 'u2', asset_code: 'MIC-002',
        planned_maintenance_record_id: 'plan-1',
      } as Partial<InventoryUnit>),
      unit({ unit_id: 'u3', asset_code: 'MIC-003', status: 'lost' }),
    ]

    const context = buildInventoryContext({
      items: [serialized()], units, teams: TEAMS, query: 'what colour is the sky',
    })

    expect(context.unitLines).toHaveLength(3)
    expect(context.omittedUnitCount).toBe(0)
  })
})
