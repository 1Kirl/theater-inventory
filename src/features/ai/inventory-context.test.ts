import { describe, expect, it } from 'vitest'
import { Timestamp } from 'firebase/firestore'
import {
  MAX_CONTEXT_ITEMS, buildInventoryContext, contextBlock, prioritizeForQuery, resolveRefs,
  serializeItem,
} from '@/features/ai/inventory-context'
import { EMPTY_CONDITION_COUNTS } from '@/domain/inventory'
import type { ConditionCounts, InventoryItem } from '@/types/inventory'
import type { TheaterTeam } from '@/types/organization'

const TEAMS = [
  { team_id: 't-sound', name: 'Sound' },
  { team_id: 't-light', name: 'Lighting' },
] as unknown as TheaterTeam[]

function counts(overrides: Partial<ConditionCounts> = {}): ConditionCounts {
  return { ...EMPTY_CONDITION_COUNTS, ...overrides }
}

type Overrides = { [K in keyof InventoryItem]?: InventoryItem[K] | undefined }

function item(overrides: Overrides = {}): InventoryItem {
  return {
    item_id: 'i-1',
    organization_id: 'org-1',
    name: 'Wireless Microphone',
    category: 'Microphones',
    team_id: 't-sound',
    quantity_total: 10,
    quantity_available: 8,
    condition_counts: counts({ good: 8, needs_repair: 2 }),
    location: 'Sound Storage',
    created_by_uid: 'u-1',
    created_at: Timestamp.fromDate(new Date(2026, 0, 1)),
    updated_at: Timestamp.fromDate(new Date(2026, 0, 1)),
    ...overrides,
  } as unknown as InventoryItem
}

describe('serializeItem', () => {
  it('carries the operational fields and nothing else', () => {
    const line = serializeItem('I1', item({
      last_inspected_at: Timestamp.fromDate(new Date(2026, 6, 10)),
    }), TEAMS)

    expect(line).toContain('I1')
    expect(line).toContain('Wireless Microphone')
    expect(line).toContain('Microphones')
    expect(line).toContain('team Sound')
    expect(line).toContain('total 10, available 8')
    expect(line).toContain('location Sound Storage')
    expect(line).toContain('last_inspected: 2026-07-10')
  })

  it('never carries an identifier or an audit field', () => {
    const line = serializeItem('I1', item(), TEAMS)

    // The whole arrangement depends on this: references are the only way to
    // name a record, so a document ID must not travel alongside them.
    expect(line).not.toContain('i-1')
    expect(line).not.toContain('org-1')
    expect(line).not.toContain('u-1')
    expect(line).not.toMatch(/created_at|updated_at|created_by/)
  })

  it('says "never inspected" in full rather than omitting the field', () => {
    // A missing line reads as missing data; "no inspection history" is a
    // question people actually ask.
    const line = serializeItem('I1', item({ last_inspected_at: undefined }), TEAMS)
    expect(line).toContain('last_inspected: null (never inspected)')
  })

  it('spells out the condition breakdown, not just the summary', () => {
    const line = serializeItem('I1', item({
      quantity_total: 6, condition_counts: counts({ good: 2, unusable: 4 }),
    }), TEAMS)

    expect(line).toContain('unusable 4')
    expect(line).toContain('good 2')
  })

  it('counts items with no recorded condition as unclassified', () => {
    const line = serializeItem('I1', item({
      quantity_total: 5, condition_counts: counts({ good: 2 }),
    }), TEAMS)
    expect(line).toContain('unclassified 3')
  })

  it('names a team that no longer exists without inventing one', () => {
    const line = serializeItem('I1', item({ team_id: 't-gone' }), TEAMS)
    expect(line).toContain('team unassigned team')
  })
})

describe('buildInventoryContext', () => {
  it('gives every record a reference in order', () => {
    const context = buildInventoryContext({
      items: [item({ item_id: 'a' }), item({ item_id: 'b' })],
      teams: TEAMS,
    })

    expect(context.lines).toHaveLength(2)
    expect(context.byRef.get('I1')?.item_id).toBe('a')
    expect(context.byRef.get('I2')?.item_id).toBe('b')
    expect(context.omittedCount).toBe(0)
  })

  it('caps the request and reports what it left out', () => {
    const many = Array.from({ length: MAX_CONTEXT_ITEMS + 7 }, (_, index) =>
      item({ item_id: `i-${index}` }))

    const context = buildInventoryContext({ items: many, teams: TEAMS })

    expect(context.lines).toHaveLength(MAX_CONTEXT_ITEMS)
    expect(context.totalAccessible).toBe(MAX_CONTEXT_ITEMS + 7)
    expect(context.omittedCount).toBe(7)
  })

  it('tells the model the list is incomplete when it is', () => {
    const many = Array.from({ length: MAX_CONTEXT_ITEMS + 1 }, (_, index) =>
      item({ item_id: `i-${index}` }))

    const block = contextBlock(buildInventoryContext({ items: many, teams: TEAMS }))
    expect(block).toMatch(/do not claim the list is complete/i)
  })

  it('says plainly when there is no inventory to reason over', () => {
    const block = contextBlock(buildInventoryContext({ items: [], teams: TEAMS }))
    expect(block).toMatch(/none supplied/i)
    expect(block).toMatch(/do not state anything about what this organization owns/i)
  })

  it('keeps the records the question is about when it has to cut', () => {
    const many = [
      ...Array.from({ length: MAX_CONTEXT_ITEMS }, (_, index) =>
        item({ item_id: `filler-${index}`, name: 'Gaffer Tape', category: 'Hardware' })),
      item({ item_id: 'wanted', name: 'Fresnel Lantern', category: 'Lighting Instruments' }),
    ]

    const context = buildInventoryContext({ items: many, teams: TEAMS, query: 'fresnel lanterns' })

    expect([...context.byRef.values()].map((entry) => entry.item_id)).toContain('wanted')
    expect(context.omittedCount).toBe(1)
  })
})

describe('prioritizeForQuery', () => {
  it('moves matching records to the front without dropping any', () => {
    const items = [
      item({ item_id: 'a', name: 'Gaffer Tape' }),
      item({ item_id: 'b', name: 'Fresnel Lantern' }),
    ]

    const ordered = prioritizeForQuery(items, 'lantern')
    expect(ordered.map((entry) => entry.item_id)).toEqual(['b', 'a'])
  })

  it('leaves the order alone when the question has nothing to match on', () => {
    const items = [item({ item_id: 'a' }), item({ item_id: 'b' })]
    expect(prioritizeForQuery(items, 'do we').map((entry) => entry.item_id)).toEqual(['a', 'b'])
  })
})

describe('resolveRefs', () => {
  const context = buildInventoryContext({
    items: [item({ item_id: 'a' }), item({ item_id: 'b' })],
    teams: TEAMS,
  })

  it('returns the real records the references name', () => {
    expect(resolveRefs(['I2', 'I1'], context).items.map((entry) => entry.item_id))
      .toEqual(['b', 'a'])
  })

  it('discards a reference that was never supplied', () => {
    // The model cannot show a record the application did not put in front of it.
    const resolved = resolveRefs(['I1', 'I99'], context)

    expect(resolved.items.map((entry) => entry.item_id)).toEqual(['a'])
    expect(resolved.unknown).toEqual(['I99'])
  })

  it('discards anything shaped like a document ID', () => {
    const resolved = resolveRefs(['a', 'i-1', 'a1B2c3D4e5F6g7H8i9J0'], context)

    expect(resolved.items).toEqual([])
    expect(resolved.unknown).toHaveLength(3)
  })

  it('keeps a repeated reference once', () => {
    const resolved = resolveRefs(['I1', 'I1', 'I1'], context)

    expect(resolved.items.map((entry) => entry.item_id)).toEqual(['a'])
    expect(resolved.duplicates).toEqual(['I1'])
  })

  it('tolerates whitespace and case', () => {
    expect(resolveRefs([' i1 '], context).items.map((entry) => entry.item_id)).toEqual(['a'])
  })

  it('returns nothing when no context was supplied', () => {
    const empty = buildInventoryContext({ items: [], teams: TEAMS })
    expect(resolveRefs(['I1'], empty).items).toEqual([])
  })
})
