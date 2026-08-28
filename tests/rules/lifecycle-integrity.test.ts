import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest'
import {
  doc, getDoc, serverTimestamp, setDoc, updateDoc, writeBatch,
  type Firestore,
  type Timestamp,
} from 'firebase/firestore'
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { buildInventoryItemDocument, buildInventoryItemUpdate } from '@/domain/inventory-payloads'
import { buildInventoryUnitDocument } from '@/domain/inventory-unit-payloads'
import { buildAssetEventDocument } from '@/domain/asset-event-payloads'
import { EMPTY_MIRRORS, withStatusChanged, withUnitsAdded } from '@/domain/inventory-unit'
import {
  ADMIN, CODE_A, EDIT_INVENTORY, ORG_A, TEAM_COSTUME, TEAM_LIGHTING,
  assertFails, assertSucceeds, createTestEnvironment,
  seedMembership, seedOrganization, seedTeam,
} from './helpers'
import type { UnitStatus } from '@/types/inventory'

/**
 * Whether lifecycle history can be bypassed or fabricated.
 *
 * The application always writes the unit, its parent, and one event together.
 * Nothing about the SDK forces that: a determined client can send whatever
 * combination of documents it likes, and these tests are what say the rules —
 * not the service — are what stop it.
 */

let environment: RulesTestEnvironment

const EDITOR = 'uid-int-editor'
const ITEM = 'itemINTEGRITYAAAAAAA'
const UNIT = 'unitINTEGRITYAAAAAAA'
const EVENT = 'eventINTEGRITYAAAAAA'

beforeAll(async () => { environment = await createTestEnvironment() })
afterAll(async () => environment.cleanup())

function db(uid: string): Firestore {
  return environment.authenticatedContext(uid).firestore() as unknown as Firestore
}

async function storedUnit() {
  let value = {
    created_at: null as unknown as Timestamp, created_by_uid: '', status: 'available' as UnitStatus,
  }
  await environment.withSecurityRulesDisabled(async (context) => {
    const store = context.firestore() as unknown as Firestore
    const snapshot = await getDoc(doc(store, 'inventory_units', UNIT))
    value = snapshot.data() as typeof value
  })
  return value
}

async function storedItem() {
  let value = { created_at: null as unknown as Timestamp, created_by_uid: '' }
  await environment.withSecurityRulesDisabled(async (context) => {
    const store = context.firestore() as unknown as Firestore
    const snapshot = await getDoc(doc(store, 'inventory_items', ITEM))
    value = snapshot.data() as typeof value
  })
  return value
}

/** A complete unit document in the given state, shaped as the service sends it. */
async function unitDoc(o: {
  status: UnitStatus
  usingTeamId?: string | null
  retirementReason?: 'disposed' | null
  condition?: 'good' | 'fair'
  storageLocation?: string
  assetCode?: string
  lastLifecycleEventId?: string
}) {
  const unit = await storedUnit()

  return {
    unit_id: UNIT,
    organization_id: ORG_A,
    inventory_item_id: ITEM,
    team_id: TEAM_LIGHTING,
    asset_code: o.assetCode ?? 'CLAMP-001',
    condition: o.condition ?? 'good',
    status: o.status,
    storage_location: o.storageLocation ?? 'Lighting Storage A',
    ...(o.retirementReason ? { retirement_reason: o.retirementReason } : {}),
    ...(o.usingTeamId ? { using_team_id: o.usingTeamId, checked_out_at: serverTimestamp() } : {}),
    ...(o.lastLifecycleEventId ? { last_lifecycle_event_id: o.lastLifecycleEventId } : {}),
    created_by_uid: unit.created_by_uid,
    created_at: unit.created_at,
    updated_at: serverTimestamp(),
  }
}

/** The parent mirrors after moving the single unit from one status to another. */
async function itemDoc(from: UnitStatus, to: UnitStatus) {
  const item = await storedItem()
  const mirrors = withStatusChanged(
    withUnitsAdded(EMPTY_MIRRORS, [{ status: from, condition: 'good' }]),
    { condition: 'good', from, to },
  )

  return buildInventoryItemUpdate({
    itemId: ITEM,
    organizationId: ORG_A,
    createdByUid: item.created_by_uid,
    createdAt: item.created_at,
    now: serverTimestamp,
    input: {
      name: 'C-Clamp',
      category: 'Hardware',
      teamId: TEAM_LIGHTING,
      trackingMode: 'serialized',
      unitCounts: mirrors.unit_counts,
      quantityTotal: mirrors.quantity_total,
      quantityAvailable: mirrors.quantity_available,
      conditionCounts: mirrors.condition_counts,
      location: 'Lighting Storage A',
    },
  })
}

/** Put the unit into a starting state, bypassing rules. */
async function setUnitStatus(status: UnitStatus, extra: Record<string, unknown> = {}) {
  await environment.withSecurityRulesDisabled(async (context) => {
    const store = context.firestore() as unknown as Firestore
    const mirrors = withUnitsAdded(EMPTY_MIRRORS, [{ status, condition: 'good' }])

    await setDoc(doc(store, 'inventory_units', UNIT), buildInventoryUnitDocument({
      unitId: UNIT,
      organizationId: ORG_A,
      inventoryItemId: ITEM,
      uid: ADMIN,
      now: serverTimestamp,
      input: {
        assetCode: 'CLAMP-001',
        owningTeamId: TEAM_LIGHTING,
        condition: 'good',
        status,
        storageLocation: 'Lighting Storage A',
        ...(status === 'in_use' ? { usingTeamId: TEAM_LIGHTING } : {}),
        ...(status === 'retired' ? { retirementReason: 'disposed' as const } : {}),
      },
      ...extra,
    }))

    await setDoc(doc(store, 'inventory_items', ITEM), buildInventoryItemDocument({
      itemId: ITEM,
      organizationId: ORG_A,
      uid: ADMIN,
      now: serverTimestamp,
      input: {
        name: 'C-Clamp',
        category: 'Hardware',
        teamId: TEAM_LIGHTING,
        trackingMode: 'serialized',
        unitCounts: mirrors.unit_counts,
        quantityTotal: mirrors.quantity_total,
        quantityAvailable: mirrors.quantity_available,
        conditionCounts: mirrors.condition_counts,
        location: 'Lighting Storage A',
      },
    }))
  })
}

beforeEach(async () => {
  await environment.clearFirestore()

  await seedOrganization(environment, { organizationId: ORG_A, adminUid: ADMIN, code: CODE_A })
  await seedTeam(environment, { teamId: TEAM_LIGHTING, organizationId: ORG_A, name: 'Lighting' })
  await seedTeam(environment, { teamId: TEAM_COSTUME, organizationId: ORG_A, name: 'Costume' })
  await seedMembership(environment, {
    organizationId: ORG_A, uid: EDITOR, teamIds: [TEAM_LIGHTING], permissions: EDIT_INVENTORY,
  })

  await setUnitStatus('available')
})

describe('AUDIT A — a status change with no history', () => {
  it.each([
    ['available', 'lost'],
    ['available', 'in_use'],
    ['available', 'retired'],
  ] as [UnitStatus, UnitStatus][])(
    'A: %s → %s with correct mirrors but no event',
    async (from, to) => {
      await setUnitStatus(from)
      const store = db(EDITOR)
      const batch = writeBatch(store)

      batch.set(doc(store, 'inventory_units', UNIT), await unitDoc({
        status: to,
        usingTeamId: to === 'in_use' ? TEAM_LIGHTING : null,
        retirementReason: to === 'retired' ? 'disposed' : null,
      }))
      batch.set(doc(store, 'inventory_items', ITEM), await itemDoc(from, to))

      await assertFails(batch.commit())
    },
  )

  it('A: lost → available with no event', async () => {
    await setUnitStatus('lost')
    const store = db(EDITOR)
    const batch = writeBatch(store)

    batch.set(doc(store, 'inventory_units', UNIT), await unitDoc({ status: 'available' }))
    batch.set(doc(store, 'inventory_items', ITEM), await itemDoc('lost', 'available'))

    await assertFails(batch.commit())
  })
})

describe('AUDIT B — a fabricated event with no transition', () => {
  it('B: an event claiming a move the unit already finished', async () => {
    // The unit is already in use. An event is appended on its own, claiming it
    // just went out. `getAfter` sees in_use either way.
    await setUnitStatus('in_use')

    await assertFails(setDoc(doc(db(EDITOR), 'asset_events', EVENT), buildAssetEventDocument({
      eventId: EVENT,
      organizationId: ORG_A,
      inventoryItemId: ITEM,
      inventoryUnitId: UNIT,
      uid: EDITOR,
      now: serverTimestamp,
      input: { eventType: 'marked_in_use', fromStatus: 'available', toStatus: 'in_use' },
    })))
  })

  it('B: an invented loss for a unit sitting on the shelf', async () => {
    await setUnitStatus('lost')

    await assertFails(setDoc(doc(db(EDITOR), 'asset_events', EVENT), buildAssetEventDocument({
      eventId: EVENT,
      organizationId: ORG_A,
      inventoryItemId: ITEM,
      inventoryUnitId: UNIT,
      uid: EDITOR,
      now: serverTimestamp,
      input: { eventType: 'marked_lost', fromStatus: 'available', toStatus: 'lost' },
    })))
  })

  it('B: an event whose from_status is not where the unit actually was', async () => {
    // A real transition, but the history line lies about where it started.
    const store = db(EDITOR)
    const batch = writeBatch(store)

    batch.set(doc(store, 'inventory_units', UNIT), await unitDoc({
      status: 'lost', lastLifecycleEventId: EVENT,
    }))
    batch.set(doc(store, 'inventory_items', ITEM), await itemDoc('available', 'lost'))
    batch.set(doc(store, 'asset_events', EVENT), buildAssetEventDocument({
      eventId: EVENT,
      organizationId: ORG_A,
      inventoryItemId: ITEM,
      inventoryUnitId: UNIT,
      uid: EDITOR,
      now: serverTimestamp,
      input: { eventType: 'marked_lost', fromStatus: 'in_use', toStatus: 'lost' },
    }))

    await assertFails(batch.commit())
  })
})

describe('AUDIT C — transitions the model forbids', () => {
  it('C: retired → available by direct write', async () => {
    await setUnitStatus('retired')
    const store = db(EDITOR)
    const batch = writeBatch(store)

    batch.set(doc(store, 'inventory_units', UNIT), await unitDoc({
      status: 'available', lastLifecycleEventId: EVENT,
    }))
    batch.set(doc(store, 'inventory_items', ITEM), await itemDoc('retired', 'available'))
    batch.set(doc(store, 'asset_events', EVENT), buildAssetEventDocument({
      eventId: EVENT,
      organizationId: ORG_A,
      inventoryItemId: ITEM,
      inventoryUnitId: UNIT,
      uid: EDITOR,
      now: serverTimestamp,
      input: { eventType: 'marked_found', fromStatus: 'retired', toStatus: 'available' },
    }))

    await assertFails(batch.commit())
  })

  it('C: retired → lost by direct write', async () => {
    await setUnitStatus('retired')
    const store = db(EDITOR)
    const batch = writeBatch(store)

    batch.set(doc(store, 'inventory_units', UNIT), await unitDoc({
      status: 'lost', lastLifecycleEventId: EVENT,
    }))
    batch.set(doc(store, 'inventory_items', ITEM), await itemDoc('retired', 'lost'))
    batch.set(doc(store, 'asset_events', EVENT), buildAssetEventDocument({
      eventId: EVENT,
      organizationId: ORG_A,
      inventoryItemId: ITEM,
      inventoryUnitId: UNIT,
      uid: EDITOR,
      now: serverTimestamp,
      input: { eventType: 'marked_lost', fromStatus: 'retired', toStatus: 'lost' },
    }))

    await assertFails(batch.commit())
  })
})

describe('what must keep working', () => {
  it('a real lifecycle transition, all three documents together', async () => {
    const store = db(EDITOR)
    const batch = writeBatch(store)

    batch.set(doc(store, 'inventory_units', UNIT), await unitDoc({
      status: 'lost', lastLifecycleEventId: EVENT,
    }))
    batch.set(doc(store, 'inventory_items', ITEM), await itemDoc('available', 'lost'))
    batch.set(doc(store, 'asset_events', EVENT), buildAssetEventDocument({
      eventId: EVENT,
      organizationId: ORG_A,
      inventoryItemId: ITEM,
      inventoryUnitId: UNIT,
      uid: EDITOR,
      now: serverTimestamp,
      input: { eventType: 'marked_lost', fromStatus: 'available', toStatus: 'lost' },
    }))

    await assertSucceeds(batch.commit())
  })

  it('a metadata edit that leaves the status alone needs no event', async () => {
    await assertSucceeds(setDoc(
      doc(db(EDITOR), 'inventory_units', UNIT),
      await unitDoc({ status: 'available', condition: 'fair', storageLocation: 'Scene Shop' }),
    ))
  })

  it('an asset code change needs no event', async () => {
    await assertSucceeds(setDoc(
      doc(db(EDITOR), 'inventory_units', UNIT),
      await unitDoc({ status: 'available', assetCode: 'CLAMP-099' }),
    ))
  })

  it('an owning team change needs no event', async () => {
    await assertSucceeds(updateDoc(doc(db(ADMIN), 'inventory_units', UNIT), {
      team_id: TEAM_COSTUME,
      updated_at: serverTimestamp(),
    }))
  })

  it.each(['available', 'in_use', 'lost'] as UnitStatus[])(
    'a brand new unit may be registered as %s with no prior history',
    async (status) => {
      const store = db(EDITOR)
      const newUnit = 'unitFRESHAAAAAAAAAAA'

      await assertSucceeds(setDoc(doc(store, 'inventory_units', newUnit),
        buildInventoryUnitDocument({
          unitId: newUnit,
          organizationId: ORG_A,
          inventoryItemId: ITEM,
          uid: EDITOR,
          now: serverTimestamp,
          input: {
            assetCode: 'CLAMP-500',
            owningTeamId: TEAM_LIGHTING,
            condition: 'good',
            status,
            storageLocation: 'Lighting Storage A',
            ...(status === 'in_use' ? { usingTeamId: TEAM_LIGHTING } : {}),
          },
        })))
    },
  )
})

/**
 * What the strengthened rules cost.
 *
 * The unit rule now reads the event, and the event rule reads the unit twice —
 * before and after. Both are `get`/`getAfter` on paths the batch already
 * touches, but that is a claim worth checking rather than assuming: decision
 * 73a is the precedent for a rule that passed review and then failed on the
 * 1000-expression limit, which from the client looks exactly like a denial.
 */
describe('the budget for a real lifecycle transition', () => {
  async function transition(uid: string, to: UnitStatus, eventId: string) {
    const store = db(uid)
    const batch = writeBatch(store)

    batch.set(doc(store, 'inventory_units', UNIT), await unitDoc({
      status: to,
      usingTeamId: to === 'in_use' ? TEAM_LIGHTING : null,
      retirementReason: to === 'retired' ? 'disposed' : null,
      lastLifecycleEventId: eventId,
    }))
    batch.set(doc(store, 'inventory_items', ITEM), await itemDoc('available', to))
    batch.set(doc(store, 'asset_events', eventId), buildAssetEventDocument({
      eventId,
      organizationId: ORG_A,
      inventoryItemId: ITEM,
      inventoryUnitId: UNIT,
      uid,
      now: serverTimestamp,
      input: {
        eventType: to === 'retired' ? 'retired' : to === 'in_use' ? 'marked_in_use' : 'marked_lost',
        fromStatus: 'available',
        toStatus: to,
        usingTeamId: to === 'in_use' ? TEAM_LIGHTING : null,
        retirementReason: to === 'retired' ? 'disposed' : null,
      },
    }))

    return batch.commit()
  }

  it.each(['in_use', 'lost', 'retired'] as UnitStatus[])(
    'a member completes a %s transition',
    async (to) => {
      await assertSucceeds(transition(EDITOR, to, 'eventMEMBERAAAAAAAAA'))
    },
  )

  it.each(['in_use', 'lost', 'retired'] as UnitStatus[])(
    'an admin completes a %s transition',
    async (to) => {
      // The heavier path: `isAdminOf` reads the organization on top of
      // everything else the three rules already spend.
      await assertSucceeds(transition(ADMIN, to, 'eventADMINAAAAAAAAAA'))
    },
  )

  it('a member moves a unit through its whole life, one transition at a time', async () => {
    // Each step re-reads the previous event id and must supply a new one, so
    // this also proves the linkage does not wedge after the first move.
    await assertSucceeds(transition(EDITOR, 'in_use', 'eventSTEP1AAAAAAAAAA'))

    const store = db(EDITOR)
    const back = writeBatch(store)
    back.set(doc(store, 'inventory_units', UNIT), await unitDoc({
      status: 'available', lastLifecycleEventId: 'eventSTEP2AAAAAAAAAA',
    }))
    back.set(doc(store, 'inventory_items', ITEM), await itemDoc('in_use', 'available'))
    back.set(doc(store, 'asset_events', 'eventSTEP2AAAAAAAAAA'), buildAssetEventDocument({
      eventId: 'eventSTEP2AAAAAAAAAA',
      organizationId: ORG_A,
      inventoryItemId: ITEM,
      inventoryUnitId: UNIT,
      uid: EDITOR,
      now: serverTimestamp,
      input: { eventType: 'checked_in', fromStatus: 'in_use', toStatus: 'available' },
    }))

    await assertSucceeds(back.commit())
  })

  it('refuses a transition that reuses the previous event id', async () => {
    // Otherwise a second move could ride on the first move's history.
    await transition(EDITOR, 'in_use', 'eventSTEP1AAAAAAAAAA')

    const store = db(EDITOR)
    const batch = writeBatch(store)
    batch.set(doc(store, 'inventory_units', UNIT), await unitDoc({
      status: 'lost', lastLifecycleEventId: 'eventSTEP1AAAAAAAAAA',
    }))
    batch.set(doc(store, 'inventory_items', ITEM), await itemDoc('in_use', 'lost'))

    await assertFails(batch.commit())
  })
})
