import { describe, expect, it } from 'vitest'
import {
  canTransition, isOfferedBulkTransition, itemStatusOf, offeredBulkTransitions,
  offeredTransitions, tracksItemStatus,
} from '@/domain/inventory'
import { buildItemAssetEventDocument, itemEventTypeFor } from '@/domain/asset-event-payloads'
import { buildInventoryItemUpdate } from '@/domain/inventory-payloads'
import { EMPTY_CONDITION_COUNTS } from '@/domain/inventory'
import { UNIT_STATUSES, type InventoryItem, type UnitStatus } from '@/types/inventory'
import type { FieldValue, Timestamp } from 'firebase/firestore'

/**
 * QA-13: a bulk item's own lifecycle.
 *
 * The thing under test is a distinction, not a feature: a bulk item has one
 * status for the whole group, and a quantity that says how much of it there is.
 * Neither constrains the other, and the tests that matter here are the ones
 * that would fail if they ever started to.
 */

const now = () => 'ts' as unknown as FieldValue

function bulk(overrides: Partial<InventoryItem> = {}): InventoryItem {
  return {
    item_id: 'i-1',
    organization_id: 'org-1',
    name: '50 ft XLR Cable',
    category: 'Cables',
    team_id: 't-sound',
    tracking_mode: 'bulk',
    quantity_total: 20,
    quantity_available: 12,
    condition_counts: { ...EMPTY_CONDITION_COUNTS, good: 20 },
    location: 'Sound Booth',
    created_by_uid: 'u-1',
    ...overrides,
  } as unknown as InventoryItem
}

describe('itemStatusOf', () => {
  it('reads an item with no stored status as available', () => {
    // Every bulk item in the live database is in exactly this position. The
    // default is a read, never a write: nothing is migrated to make it true.
    const { status: _none, ...legacy } = { ...bulk(), status: undefined }

    expect(itemStatusOf(legacy as InventoryItem)).toBe('available')
    expect(itemStatusOf(bulk())).toBe('available')
  })

  it('reads a stored status back', () => {
    for (const status of UNIT_STATUSES) {
      expect(itemStatusOf(bulk({ status }))).toBe(status)
    }
  })
})

describe('tracksItemStatus', () => {
  it('is a bulk-only question', () => {
    expect(tracksItemStatus(bulk())).toBe(true)
    expect(tracksItemStatus(bulk({ tracking_mode: 'serialized' }))).toBe(false)
  })

  it('treats an item with no tracking mode as bulk', () => {
    const { tracking_mode: _none, ...legacy } = bulk()
    expect(tracksItemStatus(legacy as InventoryItem)).toBe(true)
  })
})

describe('bulk transitions', () => {
  it('reuses the lifecycle shape rather than inventing a second one', () => {
    // Every move a bulk item is offered must be one the shared table allows.
    // A second table would be a second answer to drift from.
    for (const from of UNIT_STATUSES) {
      for (const to of offeredBulkTransitions(from)) {
        expect(canTransition(from, to), `${from} -> ${to}`).toBe(true)
      }
    }
  })

  it('keeps retired terminal, as it is for a unit', () => {
    expect(offeredBulkTransitions('retired')).toEqual([])
  })

  it('offers the maintenance pair, which a unit does not', () => {
    // The one deliberate difference. A unit cannot be moved in or out of
    // maintenance from its own page because Rules make it name the repair it is
    // away for; a bulk item carries no such pointer, so nothing is left half
    // written.
    expect(isOfferedBulkTransition('available', 'in_maintenance')).toBe(true)
    expect(isOfferedBulkTransition('in_maintenance', 'available')).toBe(true)

    expect(offeredTransitions('available')).not.toContain('in_maintenance')
  })

  it('refuses a move to itself', () => {
    for (const status of UNIT_STATUSES) {
      expect(isOfferedBulkTransition(status, status), status).toBe(false)
    }
  })
})

describe('itemEventTypeFor', () => {
  it('names the maintenance moves a unit event never produces', () => {
    expect(itemEventTypeFor('available', 'in_maintenance')).toBe('sent_to_maintenance')
    expect(itemEventTypeFor('in_maintenance', 'available')).toBe('returned_from_maintenance')
  })

  it('keeps the shared verbs for every other move', () => {
    expect(itemEventTypeFor('available', 'in_use')).toBe('marked_in_use')
    expect(itemEventTypeFor('in_use', 'available')).toBe('checked_in')
    expect(itemEventTypeFor('available', 'lost')).toBe('marked_lost')
    expect(itemEventTypeFor('lost', 'available')).toBe('marked_found')
    expect(itemEventTypeFor('in_use', 'retired')).toBe('retired')
  })

  it('produces an event for every move a bulk item is offered', () => {
    // A move with no verb could not be written down, and Rules refuse a status
    // change that brings no event — so an unnamed move would be a dead button.
    for (const from of UNIT_STATUSES) {
      for (const to of offeredBulkTransitions(from)) {
        expect(itemEventTypeFor(from, to), `${from} -> ${to}`).not.toBeNull()
      }
    }
  })
})

describe('the item event document', () => {
  const event = buildItemAssetEventDocument({
    eventId: 'e-1',
    organizationId: 'org-1',
    inventoryItemId: 'i-1',
    uid: 'u-1',
    now,
    input: {
      eventType: 'marked_in_use',
      fromStatus: 'available',
      toStatus: 'in_use',
      usingTeamId: 't-lighting',
    },
  })

  it('names no unit, because a bulk item has none', () => {
    // Inventing a unit to hang the history on would be the beginning of the
    // per-piece tracking bulk exists to avoid.
    expect(event).not.toHaveProperty('inventory_unit_id')
    expect(event).not.toHaveProperty('inventory_unit_ids')
    expect(event.inventory_item_id).toBe('i-1')
  })

  it('records the move it describes', () => {
    expect(event.from_status).toBe('available')
    expect(event.to_status).toBe('in_use')
    expect(event.event_type).toBe('marked_in_use')
  })

  it('keeps who had it, which the item stops saying', () => {
    expect(event).toHaveProperty('using_team_id', 't-lighting')
  })

  it('carries a retirement reason only on a retirement', () => {
    const retired = buildItemAssetEventDocument({
      eventId: 'e-2',
      organizationId: 'org-1',
      inventoryItemId: 'i-1',
      uid: 'u-1',
      now,
      input: {
        eventType: 'retired',
        fromStatus: 'available',
        toStatus: 'retired',
        retirementReason: 'disposed',
      },
    })

    expect(retired).toHaveProperty('retirement_reason', 'disposed')
    expect(event).not.toHaveProperty('retirement_reason')
  })
})

describe('the item document a status change writes', () => {
  const base = {
    itemId: 'i-1',
    organizationId: 'org-1',
    createdByUid: 'u-1',
    createdAt: 'created' as unknown as Timestamp,
    now,
  }
  const input = {
    name: '50 ft XLR Cable',
    category: 'Cables',
    teamId: 't-sound',
    trackingMode: 'bulk' as const,
    quantityTotal: 20,
    quantityAvailable: 12,
    conditionCounts: { ...EMPTY_CONDITION_COUNTS, good: 20 },
    location: 'Sound Booth',
  }

  it('leaves the quantities and condition exactly where they were', () => {
    // The invariant QA-13 rests on: lifecycle and quantity are different
    // questions, and moving the group must not move the numbers.
    const doc = buildInventoryItemUpdate({
      ...base,
      input: { ...input, status: 'in_use', lastLifecycleEventId: 'e-1' },
    })

    expect(doc.quantity_total).toBe(20)
    expect(doc.quantity_available).toBe(12)
    expect(doc.condition_counts).toEqual({ ...EMPTY_CONDITION_COUNTS, good: 20 })
  })

  it('stores the status and the event that produced it', () => {
    const doc = buildInventoryItemUpdate({
      ...base,
      input: { ...input, status: 'lost', lastLifecycleEventId: 'e-9' },
    })

    expect(doc).toHaveProperty('status', 'lost')
    expect(doc).toHaveProperty('last_lifecycle_event_id', 'e-9')
  })

  it('writes no status field at all when there is none to write', () => {
    // A legacy item edited through the ordinary form stays legacy rather than
    // silently gaining a field, which is what keeps this backward compatible
    // in both directions.
    const doc = buildInventoryItemUpdate({ ...base, input })

    expect(doc).not.toHaveProperty('status')
    expect(doc).not.toHaveProperty('last_lifecycle_event_id')
  })

  it('pairs a retirement reason with a retirement and drops it otherwise', () => {
    const retired = buildInventoryItemUpdate({
      ...base,
      input: { ...input, status: 'retired', retirementReason: 'donated', lastLifecycleEventId: 'e' },
    })
    const notRetired = buildInventoryItemUpdate({
      ...base,
      input: { ...input, status: 'lost', retirementReason: 'donated', lastLifecycleEventId: 'e' },
    })

    expect(retired).toHaveProperty('retirement_reason', 'donated')
    expect(notRetired).not.toHaveProperty('retirement_reason')
  })

  it('refuses to put a status on a serialized item', () => {
    // Its units each carry their own; a second answer here would be a
    // contradiction with nothing to resolve it, and Rules refuse it too.
    const doc = buildInventoryItemUpdate({
      ...base,
      input: {
        ...input,
        trackingMode: 'serialized',
        unitCounts: {
          active_total: 0, available: 0, unusable_on_hand: 0,
          in_use: 0, in_maintenance: 0, lost: 0, retired: 0,
        },
        status: 'in_use' as UnitStatus,
        lastLifecycleEventId: 'e-1',
      },
    })

    expect(doc).not.toHaveProperty('status')
    expect(doc).not.toHaveProperty('last_lifecycle_event_id')
  })
})
