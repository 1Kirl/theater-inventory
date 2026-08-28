import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest'
import {
  deleteDoc, doc, getDoc, serverTimestamp, setDoc, updateDoc, writeBatch,
  type Firestore,
  type Timestamp,
} from 'firebase/firestore'
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { buildInventoryItemDocument, buildInventoryItemUpdate } from '@/domain/inventory-payloads'
import { buildInventoryUnitDocument } from '@/domain/inventory-unit-payloads'
import { buildAssetEventDocument } from '@/domain/asset-event-payloads'
import { EMPTY_MIRRORS, withStatusChanged, withUnitsAdded } from '@/domain/inventory-unit'
import {
  ADMIN, CODE_A, EDIT_INVENTORY, ORG_A, ORG_B, OUTSIDER, TEAM_COSTUME, TEAM_LIGHTING,
  VIEW_INVENTORY, assertFails, assertSucceeds, createTestEnvironment,
  seedMembership, seedOrganization, seedTeam,
} from './helpers'

/**
 * Lifecycle history, and the three-document transaction that writes it.
 *
 * The interesting part is `assetEventMatchesUnit`: an event is checked against
 * the unit as it will be once the batch commits, so it cannot claim a move the
 * unit did not make, and cannot be filed by someone who could not have made it.
 */

let environment: RulesTestEnvironment

const LIGHTING_EDITOR = 'uid-ev-lighting'
const COSTUME_EDITOR = 'uid-ev-costume'
const VIEWER = 'uid-ev-viewer'

const ITEM = 'itemEVENTAAAAAAAAAAA'
const UNIT = 'unitEVENTAAAAAAAAAAA'
const EVENT = 'eventAAAAAAAAAAAAAAA'

beforeAll(async () => { environment = await createTestEnvironment() })
afterAll(async () => environment.cleanup())

function db(uid: string): Firestore {
  return environment.authenticatedContext(uid).firestore() as unknown as Firestore
}

async function stored(path: string, id: string) {
  let value = { created_at: null as unknown as Timestamp, created_by_uid: '' }
  await environment.withSecurityRulesDisabled(async (context) => {
    const store = context.firestore() as unknown as Firestore
    const snapshot = await getDoc(doc(store, path, id))
    value = snapshot.data() as typeof value
  })
  return value
}

/** The unit document as a lifecycle action leaves it. */
function unitAfter(o: {
  status: 'available' | 'in_use' | 'lost' | 'retired'
  usingTeamId?: string | null
  retirementReason?: 'disposed' | null
  createdByUid: string
  createdAt: Timestamp
  teamId?: string
  eventId?: string
}) {
  return {
    unit_id: UNIT,
    organization_id: ORG_A,
    inventory_item_id: ITEM,
    team_id: o.teamId ?? TEAM_LIGHTING,
    asset_code: 'CLAMP-001',
    condition: 'good',
    status: o.status,
    storage_location: 'Lighting Storage A',
    ...(o.retirementReason ? { retirement_reason: o.retirementReason } : {}),
    ...(o.usingTeamId ? { using_team_id: o.usingTeamId, checked_out_at: serverTimestamp() } : {}),
    // Names the event this status came from, which is what Rules require of a
    // transition and what the service sends.
    last_lifecycle_event_id: o.eventId ?? EVENT,
    created_by_uid: o.createdByUid,
    created_at: o.createdAt,
    updated_at: serverTimestamp(),
  }
}

/** The parent mirrors after that move. */
async function itemAfter(to: 'available' | 'in_use' | 'lost' | 'retired', from = 'available') {
  const item = await stored('inventory_items', ITEM)
  const mirrors = withStatusChanged(
    withUnitsAdded(EMPTY_MIRRORS, [{ status: 'available', condition: 'good' }]),
    { condition: 'good', from: from as 'available', to },
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

/** The whole action, as the service sends it: unit, parent, and one event. */
async function lifecycleBatch(o: {
  uid: string
  to: 'available' | 'in_use' | 'lost' | 'retired'
  eventType: 'marked_in_use' | 'checked_in' | 'marked_lost' | 'marked_found' | 'retired'
  usingTeamId?: string | null
  retirementReason?: 'disposed' | null
  eventId?: string
  eventOverrides?: Record<string, unknown>
  unitTeamId?: string
}) {
  const unit = await stored('inventory_units', UNIT)
  const store = db(o.uid)
  const batch = writeBatch(store)

  batch.set(doc(store, 'inventory_units', UNIT), unitAfter({
    status: o.to,
    usingTeamId: o.usingTeamId ?? null,
    retirementReason: o.retirementReason ?? null,
    createdByUid: unit.created_by_uid,
    createdAt: unit.created_at,
    eventId: o.eventId ?? EVENT,
    ...(o.unitTeamId ? { teamId: o.unitTeamId } : {}),
  }))
  batch.set(doc(store, 'inventory_items', ITEM), await itemAfter(o.to))
  batch.set(doc(store, 'asset_events', o.eventId ?? EVENT), {
    ...buildAssetEventDocument({
      eventId: o.eventId ?? EVENT,
      organizationId: ORG_A,
      inventoryItemId: ITEM,
      inventoryUnitId: UNIT,
      uid: o.uid,
      now: serverTimestamp,
      input: {
        eventType: o.eventType,
        fromStatus: 'available',
        toStatus: o.to,
        usingTeamId: o.usingTeamId ?? null,
        retirementReason: o.retirementReason ?? null,
      },
    }),
    ...(o.eventOverrides ?? {}),
  })

  return batch.commit()
}

beforeEach(async () => {
  await environment.clearFirestore()

  await seedOrganization(environment, { organizationId: ORG_A, adminUid: ADMIN, code: CODE_A })
  await seedTeam(environment, { teamId: TEAM_LIGHTING, organizationId: ORG_A, name: 'Lighting' })
  await seedTeam(environment, { teamId: TEAM_COSTUME, organizationId: ORG_A, name: 'Costume' })

  await seedMembership(environment, {
    organizationId: ORG_A, uid: LIGHTING_EDITOR, teamIds: [TEAM_LIGHTING],
    permissions: EDIT_INVENTORY,
  })
  await seedMembership(environment, {
    organizationId: ORG_A, uid: COSTUME_EDITOR, teamIds: [TEAM_COSTUME],
    permissions: EDIT_INVENTORY,
  })
  await seedMembership(environment, {
    organizationId: ORG_A, uid: VIEWER, teamIds: [TEAM_LIGHTING], permissions: VIEW_INVENTORY,
  })

  await environment.withSecurityRulesDisabled(async (context) => {
    const store = context.firestore() as unknown as Firestore
    const mirrors = withUnitsAdded(EMPTY_MIRRORS, [{ status: 'available', condition: 'good' }])

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
        status: 'available',
        storageLocation: 'Lighting Storage A',
      },
    }))
  })
})

describe('asset_events — the whole lifecycle action', () => {
  it('440 accepts a mark-in-use: unit, parent, and event in one write', async () => {
    // The measurement that matters. Three documents, and the event rule reads
    // the unit's post-state on top of what the unit and item rules already
    // spend. If the access-call or expression budget could not carry it, this
    // is where it would show.
    await assertSucceeds(lifecycleBatch({
      uid: LIGHTING_EDITOR, to: 'in_use', eventType: 'marked_in_use',
      usingTeamId: TEAM_LIGHTING,
    }))
  })

  it('440a an admin may lend a unit to a crew that does not own it', async () => {
    // Owned by Lighting, used by Costume. The distinction the whole borrowing
    // model exists for.
    await assertSucceeds(lifecycleBatch({
      uid: ADMIN, to: 'in_use', eventType: 'marked_in_use', usingTeamId: TEAM_COSTUME,
    }))
  })

  it('440b a member cannot lend a unit to a crew they are not on', async () => {
    // Decision 69, still holding: naming a borrowing team is a claim about a
    // crew, and a member may only make it about their own.
    await assertFails(lifecycleBatch({
      uid: LIGHTING_EDITOR, to: 'in_use', eventType: 'marked_in_use',
      usingTeamId: TEAM_COSTUME,
    }))
  })

  it('441 accepts a mark-lost', async () => {
    await assertSucceeds(lifecycleBatch({
      uid: LIGHTING_EDITOR, to: 'lost', eventType: 'marked_lost',
    }))
  })

  it('442 accepts a retirement with a reason', async () => {
    await assertSucceeds(lifecycleBatch({
      uid: LIGHTING_EDITOR, to: 'retired', eventType: 'retired', retirementReason: 'disposed',
    }))
  })

  it('443 accepts an admin performing the same action', async () => {
    await assertSucceeds(lifecycleBatch({
      uid: ADMIN, to: 'lost', eventType: 'marked_lost',
    }))
  })
})

describe('asset_events — what the event may claim', () => {
  it('444 refuses an event whose to_status is not what the unit became', async () => {
    // The unit is being marked lost; the event says it was checked in. A log
    // that can disagree with what happened is not a log.
    await assertFails(lifecycleBatch({
      uid: LIGHTING_EDITOR, to: 'lost', eventType: 'marked_lost',
      eventOverrides: { to_status: 'available', event_type: 'checked_in' },
    }))
  })

  it('445 refuses an event pointing at a different unit', async () => {
    await assertFails(lifecycleBatch({
      uid: LIGHTING_EDITOR, to: 'lost', eventType: 'marked_lost',
      eventOverrides: { inventory_unit_id: 'unitOTHERAAAAAAAAAAA' },
    }))
  })

  it('446 refuses an event naming the wrong parent item', async () => {
    await assertFails(lifecycleBatch({
      uid: LIGHTING_EDITOR, to: 'lost', eventType: 'marked_lost',
      eventOverrides: { inventory_item_id: 'itemOTHERAAAAAAAAAAA' },
    }))
  })

  it('447 refuses an event naming another organization', async () => {
    await assertFails(lifecycleBatch({
      uid: LIGHTING_EDITOR, to: 'lost', eventType: 'marked_lost',
      eventOverrides: { organization_id: ORG_B },
    }))
  })

  it('448 refuses an event attributed to somebody else', async () => {
    await assertFails(lifecycleBatch({
      uid: LIGHTING_EDITOR, to: 'lost', eventType: 'marked_lost',
      eventOverrides: { actor_uid: ADMIN },
    }))
  })

  it('449 refuses an event type outside the vocabulary', async () => {
    await assertFails(lifecycleBatch({
      uid: LIGHTING_EDITOR, to: 'lost', eventType: 'marked_lost',
      eventOverrides: { event_type: 'vanished' },
    }))
  })

  it('450 refuses an event that goes nowhere', async () => {
    await assertFails(lifecycleBatch({
      uid: LIGHTING_EDITOR, to: 'lost', eventType: 'marked_lost',
      eventOverrides: { from_status: 'lost' },
    }))
  })

  it('451 refuses a retirement with no reason', async () => {
    await assertFails(lifecycleBatch({
      uid: LIGHTING_EDITOR, to: 'retired', eventType: 'retired',
      retirementReason: 'disposed',
      eventOverrides: { retirement_reason: null },
    }))
  })

  it('452 refuses a retirement reason on a move that is not one', async () => {
    await assertFails(lifecycleBatch({
      uid: LIGHTING_EDITOR, to: 'lost', eventType: 'marked_lost',
      eventOverrides: { retirement_reason: 'disposed' },
    }))
  })

  it('453 refuses a borrowing member with no team', async () => {
    await assertFails(lifecycleBatch({
      uid: LIGHTING_EDITOR, to: 'lost', eventType: 'marked_lost',
      eventOverrides: { using_member_uid: ADMIN },
    }))
  })

  it('454 refuses an unknown field', async () => {
    await assertFails(lifecycleBatch({
      uid: LIGHTING_EDITOR, to: 'lost', eventType: 'marked_lost',
      eventOverrides: { severity: 'high' },
    }))
  })

  it('455 refuses an event with no unit behind it', async () => {
    // Nothing in the batch writes that unit, so `existsAfter` finds nothing.
    const store = db(LIGHTING_EDITOR)

    await assertFails(setDoc(doc(store, 'asset_events', EVENT), buildAssetEventDocument({
      eventId: EVENT,
      organizationId: ORG_A,
      inventoryItemId: ITEM,
      inventoryUnitId: 'unitGHOSTAAAAAAAAAAA',
      uid: LIGHTING_EDITOR,
      now: serverTimestamp,
      input: { eventType: 'marked_lost', fromStatus: 'available', toStatus: 'lost' },
    })))
  })
})

describe('asset_events — who may write one', () => {
  it('456 refuses an editor from another team', async () => {
    // The unit is Lighting's. Costume has inventory edit, and no business
    // moving it.
    await assertFails(lifecycleBatch({
      uid: COSTUME_EDITOR, to: 'lost', eventType: 'marked_lost',
    }))
  })

  it('457 refuses a view-only member', async () => {
    await assertFails(lifecycleBatch({
      uid: VIEWER, to: 'lost', eventType: 'marked_lost',
    }))
  })

  it('458 refuses somebody outside the organization', async () => {
    await assertFails(lifecycleBatch({
      uid: OUTSIDER, to: 'lost', eventType: 'marked_lost',
    }))
  })
})

describe('asset_events — append only', () => {
  beforeEach(async () => {
    await lifecycleBatch({ uid: LIGHTING_EDITOR, to: 'lost', eventType: 'marked_lost' })
  })

  it('459 an event cannot be edited, even by an admin', async () => {
    await assertFails(updateDoc(doc(db(ADMIN), 'asset_events', EVENT), {
      note: 'actually it was fine',
    }))
  })

  it('460 an event cannot be deleted, even by an admin', async () => {
    await assertFails(deleteDoc(doc(db(ADMIN), 'asset_events', EVENT)))
  })

  it('461 an event can be read by anyone who may view inventory', async () => {
    await assertSucceeds(getDoc(doc(db(VIEWER), 'asset_events', EVENT)))
  })

  it('462 an event cannot be read from outside the organization', async () => {
    await assertFails(getDoc(doc(db(OUTSIDER), 'asset_events', EVENT)))
  })
})
