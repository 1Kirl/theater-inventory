import { describe, expect, it } from 'vitest'
import {
  EMPTY_MIRRORS, mirrorsOf, serializedMirrorInput, withStatusChanged, withUnitsAdded,
} from '@/domain/inventory-unit'
import { buildInventoryItemUpdate } from '@/domain/inventory-payloads'
import { estimatedInventoryValue } from '@/domain/inventory-value'
import { EMPTY_CONDITION_COUNTS, EMPTY_UNIT_COUNTS } from '@/domain/inventory'
import type { InventoryItem, InventoryUnit } from '@/types/inventory'
import type { Timestamp } from 'firebase/firestore'

/**
 * A serialized item's estimated cost survives its units changing.
 *
 * It did not. Every mirror update is a whole-document write, and the object
 * three services built to describe the parent listed every field it owns except
 * `unitCostCents`. So creating the first unit — the moment an estimated cost
 * starts being worth anything — deleted it. The item reported "$10.00 each"
 * while it had no units and "Cost unknown" the instant it had one.
 *
 * The fix is one shared `serializedMirrorInput`, and what these tests actually
 * guard is that it stays complete: every path that touches the mirrors goes
 * through it, so cost is preserved by construction rather than by each caller
 * remembering.
 */

const NOW = { seconds: 1, nanoseconds: 0 } as unknown as Timestamp

function item(o: { costCents?: number | null } = {}): InventoryItem {
  const base = {
    item_id: 'item-1',
    organization_id: 'org-1',
    name: 'Wireless Microphone',
    category: 'Microphones',
    team_id: 'team-sound',
    tracking_mode: 'serialized' as const,
    unit_counts: { ...EMPTY_UNIT_COUNTS },
    quantity_total: 0,
    quantity_available: 0,
    condition_counts: { ...EMPTY_CONDITION_COUNTS },
    location: 'Booth',
    created_by_uid: 'u-1',
    created_at: NOW,
    updated_at: NOW,
  }

  // Presence, not truthiness: an item nobody priced has no field at all, which
  // is a different fact from one priced at zero.
  return (o.costCents === undefined
    ? base
    : { ...base, ...(o.costCents === null ? {} : { unit_cost_cents: o.costCents }) }
  ) as unknown as InventoryItem
}

function unit(o: {
  id: string
  status?: InventoryUnit['status']
  condition?: InventoryUnit['condition']
}): InventoryUnit {
  return {
    unit_id: o.id,
    organization_id: 'org-1',
    inventory_item_id: 'item-1',
    asset_code: `MIC-${o.id}`,
    owning_team_id: 'team-sound',
    status: o.status ?? 'available',
    condition: o.condition ?? 'good',
    storage_location: 'Booth',
    created_by_uid: 'u-1',
    created_at: NOW,
    updated_at: NOW,
  } as unknown as InventoryUnit
}

/** The document a mirror update actually writes to Firestore. */
function writtenDocument(parent: InventoryItem, mirrors: Parameters<typeof serializedMirrorInput>[1]) {
  return buildInventoryItemUpdate({
    itemId: parent.item_id,
    organizationId: parent.organization_id,
    createdByUid: parent.created_by_uid,
    createdAt: parent.created_at,
    now: () => NOW,
    input: serializedMirrorInput(parent, mirrors),
  })
}

describe('the reported reproduction: $10 item, then units', () => {
  const priced = item({ costCents: 1000 })

  it('reports the cost and a zero value while it has no units', () => {
    expect(priced.unit_cost_cents).toBe(1000)
    expect(estimatedInventoryValue(priced)).toBe(0)
  })

  it('keeps the cost when the first unit is added', () => {
    const next = withUnitsAdded(EMPTY_MIRRORS, [unit({ id: 'u1' })])
    const written = writtenDocument(priced, next)

    expect(written.unit_cost_cents).toBe(1000)
    expect(written.unit_counts?.active_total).toBe(1)
  })

  it('keeps the cost when several units are generated at once', () => {
    const next = withUnitsAdded(EMPTY_MIRRORS, [
      unit({ id: 'u1' }), unit({ id: 'u2' }), unit({ id: 'u3' }),
      unit({ id: 'u4' }), unit({ id: 'u5' }),
    ])
    const written = writtenDocument(priced, next)

    expect(written.unit_cost_cents).toBe(1000)
    expect(written.quantity_total).toBe(5)
  })

  it('values the item at unit count × parent cost as units accumulate', () => {
    for (const [count, expected] of [[0, 0], [1, 1000], [5, 5000]] as const) {
      const mirrors = withUnitsAdded(
        EMPTY_MIRRORS,
        Array.from({ length: count }, (_, i) => unit({ id: `u${i}` })),
      )
      const written = writtenDocument(priced, mirrors)
      const after = { ...priced, ...written } as unknown as InventoryItem

      expect(estimatedInventoryValue(after)).toBe(expected)
    }
  })
})

describe('every path that rewrites the mirrors', () => {
  const priced = item({ costCents: 1000 })
  const oneUnit = withUnitsAdded(EMPTY_MIRRORS, [unit({ id: 'u1' })])

  it('keeps the cost through a lifecycle transition', () => {
    const next = withStatusChanged(oneUnit, { from: 'available', to: 'in_use', condition: 'good' })
    expect(writtenDocument(priced, next).unit_cost_cents).toBe(1000)
  })

  it('keeps the cost when a unit goes out for maintenance and comes back', () => {
    const out = withStatusChanged(oneUnit, {
      from: 'available', to: 'in_maintenance', condition: 'good',
    })
    expect(writtenDocument(priced, out).unit_cost_cents).toBe(1000)

    const back = withStatusChanged(out, {
      from: 'in_maintenance', to: 'available', condition: 'good',
    })
    expect(writtenDocument(priced, back).unit_cost_cents).toBe(1000)
  })

  it('keeps the cost when a unit is retired', () => {
    const next = withStatusChanged(oneUnit, { from: 'available', to: 'retired', condition: 'good' })
    expect(writtenDocument(priced, next).unit_cost_cents).toBe(1000)
  })

  it('keeps the cost when a unit is marked lost and then found', () => {
    const lost = withStatusChanged(oneUnit, { from: 'available', to: 'lost', condition: 'good' })
    expect(writtenDocument(priced, lost).unit_cost_cents).toBe(1000)

    const found = withStatusChanged(lost, { from: 'lost', to: 'available', condition: 'good' })
    expect(writtenDocument(priced, found).unit_cost_cents).toBe(1000)
  })

  it('keeps the cost when a bulk item is promoted and its units created', () => {
    const promoted = item({ costCents: 1000 })
    const mirrors = mirrorsOf(promoted)
    expect(writtenDocument(promoted, mirrors).unit_cost_cents).toBe(1000)
  })
})

describe('known zero and unknown stay different', () => {
  it('preserves a cost genuinely recorded as zero', () => {
    const free = item({ costCents: 0 })
    const written = writtenDocument(free, withUnitsAdded(EMPTY_MIRRORS, [unit({ id: 'u1' })]))

    expect(written.unit_cost_cents).toBe(0)
    expect('unit_cost_cents' in written).toBe(true)
  })

  it('values a known-zero item at zero rather than reporting it unknown', () => {
    const free = item({ costCents: 0 })
    const written = writtenDocument(free, withUnitsAdded(EMPTY_MIRRORS, [unit({ id: 'u1' })]))
    const after = { ...free, ...written } as unknown as InventoryItem

    expect(estimatedInventoryValue(after)).toBe(0)
  })

  it('leaves an unpriced item unpriced rather than inventing a zero', () => {
    const unpriced = item()
    const written = writtenDocument(unpriced, withUnitsAdded(EMPTY_MIRRORS, [unit({ id: 'u1' })]))

    expect('unit_cost_cents' in written).toBe(false)
    const after = { ...unpriced, ...written } as unknown as InventoryItem
    expect(estimatedInventoryValue(after)).toBeNull()
  })
})

/**
 * The reason the defect existed at all was three hand-maintained copies of this
 * object, so the useful guard is not "cost is present" but "nothing the parent
 * owns is missing". A field added to the item in future fails here rather than
 * being silently deleted the next time a unit moves.
 */
describe('the mirror input carries every parent-owned field', () => {
  const parent = item({ costCents: 1000 })
  const written = writtenDocument(parent, withUnitsAdded(EMPTY_MIRRORS, [unit({ id: 'u1' })]))

  it('preserves identity, authorship, and the fields the user set', () => {
    expect(written.item_id).toBe(parent.item_id)
    expect(written.organization_id).toBe(parent.organization_id)
    expect(written.created_by_uid).toBe(parent.created_by_uid)
    expect(written.name).toBe(parent.name)
    expect(written.category).toBe(parent.category)
    expect(written.team_id).toBe(parent.team_id)
    expect(written.location).toBe(parent.location)
    expect(written.tracking_mode).toBe('serialized')
    expect(written.unit_cost_cents).toBe(1000)
  })

  it('writes no key the item did not already own', () => {
    const original = new Set(Object.keys(parent))
    for (const key of Object.keys(written)) {
      expect(original.has(key)).toBe(true)
    }
  })

  it('drops no key the item owned', () => {
    for (const key of Object.keys(parent)) {
      expect(Object.keys(written)).toContain(key)
    }
  })
})
