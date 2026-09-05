import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  doc, getDoc, serverTimestamp, setDoc, writeBatch,
  type Firestore,
  type Timestamp,
} from 'firebase/firestore'
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { buildInventoryItemDocument, buildInventoryItemUpdate } from '@/domain/inventory-payloads'
import { buildItemAssetEventDocument, itemEventTypeFor } from '@/domain/asset-event-payloads'
import { EMPTY_CONDITION_COUNTS } from '@/domain/inventory'
import {
  ADMIN, CODE_A, CODE_B, EDIT_INVENTORY, ORG_A, ORG_B, OUTSIDER, TEAM_COSTUME, TEAM_LIGHTING,
  TEAM_OTHER_ORG, VIEW_INVENTORY, assertFails, assertSucceeds, createTestEnvironment,
  seedMembership, seedOrganization, seedTeam,
} from './helpers'
import type { InventoryItem, RetirementReason, UnitStatus } from '@/types/inventory'

/**
 * QA-13: a bulk item's own lifecycle, enforced.
 *
 * The item gains a status and a pointer to the event that produced it, and the
 * pair is what Rules police: a status cannot move without an event describing
 * exactly that move, and an event cannot be filed for a move that did not
 * happen. It is the same device the unit rule uses, because Rules cannot search
 * a collection and the document has to name its own history.
 *
 * The other half of the job is making sure nothing already written notices.
 * Every existing asset event names a unit, and every existing bulk item has no
 * status at all — both have to keep working exactly as they did.
 */

let environment: RulesTestEnvironment

const EDITOR = 'uid-il-editor'
const VIEWER = 'uid-il-viewer'
const COSTUME_EDITOR = 'uid-il-costume'

const BULK = 'itemBULKLIFECYCLEAAAA'
const LEGACY = 'itemBULKLEGACYAAAAAA'
const SERIAL = 'itemSERIALLIFEAAAAAA'
const OTHER_ORG = 'itemBULKOTHERORGAAAA'

beforeAll(async () => { environment = await createTestEnvironment() })
afterAll(async () => environment.cleanup())

function db(uid: string | null): Firestore {
  const context = uid ? environment.authenticatedContext(uid) : environment.unauthenticatedContext()
  return context.firestore() as unknown as Firestore
}

function itemPayload(o: {
  itemId?: string; organizationId?: string; teamId?: string; uid?: string
  status?: UnitStatus; serialized?: boolean
} = {}) {
  const base = buildInventoryItemDocument({
    itemId: o.itemId ?? BULK,
    organizationId: o.organizationId ?? ORG_A,
    uid: o.uid ?? ADMIN,
    now: serverTimestamp,
    input: {
      name: '50 ft XLR Cable',
      category: 'Cables',
      teamId: o.teamId ?? TEAM_LIGHTING,
      trackingMode: o.serialized ? 'serialized' : 'bulk',
      ...(o.serialized
        ? {
          unitCounts: {
            active_total: 0, available: 0, unusable_on_hand: 0,
            in_use: 0, in_maintenance: 0, lost: 0, retired: 0,
          },
          quantityTotal: 0,
          quantityAvailable: 0,
          conditionCounts: EMPTY_CONDITION_COUNTS,
        }
        : {
          quantityTotal: 20,
          quantityAvailable: 12,
          conditionCounts: { ...EMPTY_CONDITION_COUNTS, good: 20 },
        }),
      location: 'Sound Booth',
      ...(o.status ? { status: o.status } : {}),
    },
  })
  return base
}

/** The write the service sends: item and event together, or neither. */
async function moveStatus(o: {
  uid: string
  to: UnitStatus
  itemId?: string
  from?: UnitStatus
  retirementReason?: RetirementReason
  /** Corrupt the event to prove Rules read it rather than trusting the item. */
  forge?: 'wrong-from' | 'wrong-to' | 'other-item' | 'unlinked'
  /** Write only the item, with no event at all. */
  skipEvent?: boolean
}) {
  const itemId = o.itemId ?? BULK
  let item = {} as InventoryItem

  await environment.withSecurityRulesDisabled(async (context) => {
    const store = context.firestore() as unknown as Firestore
    item = (await getDoc(doc(store, 'inventory_items', itemId))).data() as InventoryItem
  })

  const from = o.from ?? (item.status ?? 'available')
  const store = db(o.uid)
  const batch = writeBatch(store)
  const eventId = `evt${Math.random().toString(36).slice(2, 12).padEnd(10, 'x')}`

  batch.set(doc(store, 'inventory_items', itemId), buildInventoryItemUpdate({
    itemId,
    organizationId: item.organization_id,
    createdByUid: item.created_by_uid,
    createdAt: item.created_at as unknown as Timestamp,
    now: serverTimestamp,
    input: {
      name: item.name,
      category: item.category,
      teamId: item.team_id,
      trackingMode: 'bulk',
      quantityTotal: item.quantity_total,
      quantityAvailable: item.quantity_available,
      conditionCounts: item.condition_counts,
      location: item.location,
      status: o.to,
      retirementReason: o.retirementReason,
      lastLifecycleEventId: o.forge === 'unlinked' ? 'evtSOMETHINGELSEXX' : eventId,
    },
  }))

  if (!o.skipEvent) {
    const eventType = itemEventTypeFor(from, o.to)
    batch.set(doc(store, 'asset_events', eventId), buildItemAssetEventDocument({
      eventId,
      organizationId: item.organization_id,
      inventoryItemId: o.forge === 'other-item' ? SERIAL : itemId,
      uid: o.uid,
      now: serverTimestamp,
      input: {
        eventType: eventType ?? 'marked_in_use',
        fromStatus: o.forge === 'wrong-from' ? 'lost' : from,
        toStatus: o.forge === 'wrong-to' ? 'lost' : o.to,
        retirementReason: o.retirementReason ?? null,
      },
    }))
  }

  return batch.commit()
}

beforeEach(async () => {
  await environment.clearFirestore()

  await seedOrganization(environment, { organizationId: ORG_A, adminUid: ADMIN, code: CODE_A })
  await seedOrganization(environment, { organizationId: ORG_B, adminUid: OUTSIDER, code: CODE_B })

  await seedTeam(environment, { teamId: TEAM_LIGHTING, organizationId: ORG_A, name: 'Lighting' })
  await seedTeam(environment, { teamId: TEAM_COSTUME, organizationId: ORG_A, name: 'Costume' })
  await seedTeam(environment, { teamId: TEAM_OTHER_ORG, organizationId: ORG_B, name: 'Sound' })

  await seedMembership(environment, {
    organizationId: ORG_A, uid: EDITOR, teamIds: [TEAM_LIGHTING], permissions: EDIT_INVENTORY,
  })
  await seedMembership(environment, {
    organizationId: ORG_A, uid: VIEWER, teamIds: [TEAM_LIGHTING], permissions: VIEW_INVENTORY,
  })
  await seedMembership(environment, {
    organizationId: ORG_A, uid: COSTUME_EDITOR, teamIds: [TEAM_COSTUME], permissions: EDIT_INVENTORY,
  })

  await environment.withSecurityRulesDisabled(async (context) => {
    const store = context.firestore() as unknown as Firestore
    await setDoc(doc(store, 'inventory_items', BULK), itemPayload())
    // Written before item lifecycle existed: no `status` key at all.
    await setDoc(doc(store, 'inventory_items', LEGACY), itemPayload({ itemId: LEGACY }))
    await setDoc(doc(store, 'inventory_items', SERIAL),
      itemPayload({ itemId: SERIAL, serialized: true }))
    await setDoc(doc(store, 'inventory_items', OTHER_ORG), itemPayload({
      itemId: OTHER_ORG, organizationId: ORG_B, teamId: TEAM_OTHER_ORG, uid: OUTSIDER,
    }))
  })
})

describe('backward compatibility', () => {
  it('stores no status on an item that never had one', () => {
    // The seed above is what the live database holds. If the payload builder
    // started writing a default, this is what would say so.
    expect(itemPayload({ itemId: LEGACY })).not.toHaveProperty('status')
  })

  it('lets a legacy item still be edited without gaining a status', async () => {
    // The ordinary edit form path. It must not fail validation, and it must not
    // quietly add a field either.
    let item = {} as InventoryItem
    await environment.withSecurityRulesDisabled(async (context) => {
      const store = context.firestore() as unknown as Firestore
      item = (await getDoc(doc(store, 'inventory_items', LEGACY))).data() as InventoryItem
    })

    await assertSucceeds(setDoc(doc(db(EDITOR), 'inventory_items', LEGACY),
      buildInventoryItemUpdate({
        itemId: LEGACY,
        organizationId: item.organization_id,
        createdByUid: item.created_by_uid,
        createdAt: item.created_at as unknown as Timestamp,
        now: serverTimestamp,
        input: {
          name: 'Renamed cable',
          category: item.category,
          teamId: item.team_id,
          trackingMode: 'bulk',
          quantityTotal: item.quantity_total,
          quantityAvailable: item.quantity_available,
          conditionCounts: item.condition_counts,
          location: item.location,
        },
      })))
  })

  it('moves a legacy item from the available it reads as', async () => {
    // No stored status, so Rules default it to `available` and the move from
    // there is legal without anything being migrated first.
    await assertSucceeds(moveStatus({ uid: EDITOR, itemId: LEGACY, to: 'in_use' }))
  })
})

describe('a bulk item moves through its life', () => {
  it('lets an inventory editor on the owning team move it', async () => {
    await assertSucceeds(moveStatus({ uid: EDITOR, to: 'in_use' }))
  })

  it('lets the Admin move it', async () => {
    await assertSucceeds(moveStatus({ uid: ADMIN, to: 'lost' }))
  })

  it('records the status and the event that produced it', async () => {
    await assertSucceeds(moveStatus({ uid: EDITOR, to: 'in_use' }))

    await environment.withSecurityRulesDisabled(async (context) => {
      const store = context.firestore() as unknown as Firestore
      const item = (await getDoc(doc(store, 'inventory_items', BULK))).data() as InventoryItem

      expect(item.status).toBe('in_use')
      expect(item.last_lifecycle_event_id).toBeTruthy()
    })
  })

  it('leaves the quantities and condition exactly where they were', async () => {
    // The QA-13 invariant: lifecycle and quantity are different questions.
    await assertSucceeds(moveStatus({ uid: EDITOR, to: 'in_maintenance' }))

    await environment.withSecurityRulesDisabled(async (context) => {
      const store = context.firestore() as unknown as Firestore
      const item = (await getDoc(doc(store, 'inventory_items', BULK))).data() as InventoryItem

      expect(item.quantity_total).toBe(20)
      expect(item.quantity_available).toBe(12)
      expect(item.condition_counts).toEqual({ ...EMPTY_CONDITION_COUNTS, good: 20 })
    })
  })

  it('takes a group to the shop and back', async () => {
    await assertSucceeds(moveStatus({ uid: EDITOR, to: 'in_maintenance' }))
    await assertSucceeds(moveStatus({ uid: EDITOR, to: 'available', from: 'in_maintenance' }))
  })

  it('requires a reason to retire', async () => {
    await assertFails(moveStatus({ uid: EDITOR, to: 'retired' }))
    await assertSucceeds(moveStatus({ uid: EDITOR, to: 'retired', retirementReason: 'disposed' }))
  })

  it('refuses a retirement reason on a status that is not a retirement', async () => {
    // The payload builder already drops it, so this goes around the builder to
    // reach the rule — the guarantee has to hold against a hand-built write,
    // not only against our own client.
    let item = {} as InventoryItem
    await environment.withSecurityRulesDisabled(async (context) => {
      const store = context.firestore() as unknown as Firestore
      item = (await getDoc(doc(store, 'inventory_items', BULK))).data() as InventoryItem
    })

    await assertFails(setDoc(doc(db(EDITOR), 'inventory_items', BULK), {
      ...item,
      status: 'lost',
      retirement_reason: 'disposed',
      updated_at: serverTimestamp(),
    }))
  })
})

describe('a status cannot move on its own', () => {
  it('refuses a status change that brings no event', async () => {
    // The whole point. Without this a bulk item could be quietly rewritten to
    // any state with nothing recording that it happened.
    await assertFails(moveStatus({ uid: EDITOR, to: 'in_use', skipEvent: true }))
  })

  it('refuses an item pointing at an event that is not this move', async () => {
    await assertFails(moveStatus({ uid: EDITOR, to: 'in_use', forge: 'unlinked' }))
  })

  it('refuses an event that misstates where the item came from', async () => {
    await assertFails(moveStatus({ uid: EDITOR, to: 'in_use', forge: 'wrong-from' }))
  })

  it('refuses an event that misstates where the item ended up', async () => {
    await assertFails(moveStatus({ uid: EDITOR, to: 'in_use', forge: 'wrong-to' }))
  })

  it('refuses an event filed against a different item', async () => {
    await assertFails(moveStatus({ uid: EDITOR, to: 'in_use', forge: 'other-item' }))
  })

  it('refuses a move the lifecycle does not allow', async () => {
    // Retired is terminal.
    await assertSucceeds(moveStatus({ uid: EDITOR, to: 'retired', retirementReason: 'sold' }))
    await assertFails(moveStatus({ uid: EDITOR, to: 'available', from: 'retired' }))
  })
})

describe('moving a bulk item is bounded by inventory permission', () => {
  it('refuses a member who may only view', async () => {
    await assertFails(moveStatus({ uid: VIEWER, to: 'in_use' }))
  })

  it('refuses an editor on a different team', async () => {
    await assertFails(moveStatus({ uid: COSTUME_EDITOR, to: 'in_use' }))
  })

  it('refuses somebody from another organization', async () => {
    await assertFails(moveStatus({ uid: OUTSIDER, to: 'in_use' }))
    await assertFails(moveStatus({ uid: EDITOR, itemId: OTHER_ORG, to: 'in_use' }))
  })
})

describe('serialized items are left alone', () => {
  it('refuses a status on an item whose units carry their own', async () => {
    let item = {} as InventoryItem
    await environment.withSecurityRulesDisabled(async (context) => {
      const store = context.firestore() as unknown as Firestore
      item = (await getDoc(doc(store, 'inventory_items', SERIAL))).data() as InventoryItem
    })

    // Bypassing the payload builder, which drops the field for a serialized
    // item — this is the write a client could still attempt by hand.
    await assertFails(setDoc(doc(db(EDITOR), 'inventory_items', SERIAL), {
      ...item,
      status: 'in_use',
      updated_at: serverTimestamp(),
    }))
  })
})
