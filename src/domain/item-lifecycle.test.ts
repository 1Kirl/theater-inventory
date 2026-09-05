import { describe, expect, it } from 'vitest'
import {
  canTransition, isOfferedBulkTransition, isSerialized, itemStatusOf, offeredBulkTransitions,
  offeredTransitions, tracksItemStatus,
} from '@/domain/inventory'
import { buildItemAssetEventDocument, itemEventTypeFor } from '@/domain/asset-event-payloads'
import { bulkMaintenanceStatusFor, currentlyInService } from '@/domain/maintenance'
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

  it('offers exactly what a unit is offered, and nothing else', () => {
    // A bulk item differs from a unit in how finely it is counted, not in how
    // equipment moves through its life. Any divergence here is a second
    // workflow for the same operation.
    for (const from of UNIT_STATUSES) {
      expect(offeredBulkTransitions(from), from).toEqual(offeredTransitions(from))
    }
  })

  it('never offers a maintenance move from Inventory', () => {
    // Maintenance is entered and left through the repair record, which moves
    // the status in the same write. Offering it here would let somebody say
    // equipment is at a shop with no repair behind it.
    for (const from of UNIT_STATUSES) {
      expect(offeredBulkTransitions(from), from).not.toContain('in_maintenance')
    }
    expect(offeredBulkTransitions('in_maintenance')).toEqual([])
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

  it('still names the maintenance moves the maintenance service makes', () => {
    // Not offered from Inventory, but the repair workflow performs them and
    // Rules require every status change to carry an event.
    expect(itemEventTypeFor('available', 'in_maintenance')).toBe('sent_to_maintenance')
    expect(itemEventTypeFor('in_maintenance', 'available')).toBe('returned_from_maintenance')
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

describe('maintenance drives the bulk item status', () => {
  const rec = (status: string) => ({ status }) as never

  it('sends the group away when a repair becomes active', () => {
    // The QA correction: Inventory does not offer this move; the repair does.
    expect(bulkMaintenanceStatusFor('available', [rec('sent')])).toBe('in_maintenance')
    expect(bulkMaintenanceStatusFor('available', [rec('in_service')])).toBe('in_maintenance')
    expect(bulkMaintenanceStatusFor('available', [rec('ready')])).toBe('in_maintenance')
  })

  it('leaves it alone for a repair that has not left yet', () => {
    // `planned` is a commitment, not equipment that is away — the same
    // distinction `ACTIVE_STATUSES` already draws for the quantity figures.
    expect(bulkMaintenanceStatusFor('available', [rec('planned')])).toBeNull()
  })

  it('brings the group back only when the last repair closes', () => {
    // A bulk item can be on several repairs at once, unlike a unit. One
    // returning while another is still out must not bring it back.
    expect(bulkMaintenanceStatusFor('in_maintenance', [rec('returned'), rec('sent')])).toBeNull()
    expect(bulkMaintenanceStatusFor('in_maintenance', [rec('returned'), rec('cancelled')]))
      .toBe('available')
    expect(bulkMaintenanceStatusFor('in_maintenance', [])).toBe('available')
  })

  it('never overwrites where the equipment actually is', () => {
    // Maintenance swaps available and in_maintenance and nothing else, exactly
    // as `isMaintenanceMove` allows for a unit. Equipment signed out or lost is
    // not at a repair shop, and a repair filed against it says nothing about
    // where it is.
    for (const status of ['in_use', 'lost', 'retired'] as const) {
      expect(bulkMaintenanceStatusFor(status, [rec('sent')]), status).toBeNull()
      expect(bulkMaintenanceStatusFor(status, [rec('returned')]), status).toBeNull()
    }
  })

  it('asks for no move when the status already matches', () => {
    expect(bulkMaintenanceStatusFor('in_maintenance', [rec('sent')])).toBeNull()
    expect(bulkMaintenanceStatusFor('available', [rec('returned')])).toBeNull()
  })

  it('leaves quantity_sent to answer its own question', () => {
    // The lifecycle status says the group is away; the records go on saying how
    // many pieces. Five of twenty is still five.
    const records = [
      { status: 'sent', quantity_sent: 3 },
      { status: 'in_service', quantity_sent: 2 },
      { status: 'returned', quantity_sent: 9 },
    ] as never[]

    expect(currentlyInService(records)).toBe(5)
    expect(bulkMaintenanceStatusFor('available', records)).toBe('in_maintenance')
  })
})

describe('the Inventory lifecycle service refuses maintenance moves', () => {
  it('is the service, not only the UI, that refuses them', async () => {
    // Hiding the button is an affordance; this is the guarantee. Imported
    // lazily so this file stays a pure domain test.
    const { itemLifecycleRefusal } = await import('@/services/item-lifecycle-service')

    for (const [from, to] of [['available', 'in_maintenance'], ['in_maintenance', 'available']] as const) {
      const reason = itemLifecycleRefusal({ item: bulk({ status: from }), to })
      expect(reason, `${from} -> ${to}`).toContain('Use Maintenance instead')
    }
  })

  it('still allows the ordinary lifecycle moves', () => {
    // Available -> In Use / Lost / Retired, the three Inventory offers.
    expect(offeredBulkTransitions('available')).toEqual(['in_use', 'lost', 'retired'])
  })
})

describe('bulk quantities are never turned into units', () => {
  it('keeps a bulk item bulk, with no unit counts', () => {
    const item = bulk({ quantity_total: 20 })

    expect(isSerialized(item)).toBe(false)
    expect(item).not.toHaveProperty('unit_counts')
    expect(tracksItemStatus(item)).toBe(true)
  })
})
