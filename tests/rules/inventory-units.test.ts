import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  collection, doc, getDoc, getDocs, query, serverTimestamp, setDoc, updateDoc, where,
  type Firestore,
  type Timestamp,
} from 'firebase/firestore'
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing'
import {
  buildInventoryItemDocument, buildInventoryItemUpdate,
} from '@/domain/inventory-payloads'
import { buildInventoryUnitDocument } from '@/domain/inventory-unit-payloads'
import { EMPTY_CONDITION_COUNTS, unitCountsFrom } from '@/domain/inventory'
import {
  ADMIN, CODE_A, CODE_B, EDIT_INVENTORY, ORG_A, ORG_B, OUTSIDER, TEAM_COSTUME, TEAM_LIGHTING,
  TEAM_OTHER_ORG, VIEW_INVENTORY, assertFails, assertSucceeds, createTestEnvironment,
  seedMembership, seedOrganization, seedTeam,
} from './helpers'

/**
 * Phase 11A: the serialized inventory contract, enforced.
 *
 * Nothing writes a unit yet. These tests are what says the rules are right
 * before anything depends on them.
 */

let environment: RulesTestEnvironment

const VIEWER = 'uid-unit-viewer'
const EDITOR = 'uid-unit-editor'
const COSTUME_EDITOR = 'uid-unit-costume'
const NO_ACCESS = 'uid-unit-none'
/** On both crews, for the cases where a unit changes hands. */
const BOTH_TEAMS = 'uid-unit-both'

const ITEM_LIGHTING = 'itemLIGHTINGAAAAAAAA'
const ITEM_COSTUME = 'itemCOSTUMEBBBBBBBBB'
const ITEM_OTHER_ORG = 'itemOTHERORGCCCCCCCC'

const UNIT_LIGHTING = 'unitLIGHTINGAAAAAAAA'
const UNIT_COSTUME = 'unitCOSTUMEBBBBBBBBBB'
const NEW_UNIT = 'unitNEWNEWNEWNEWNEW1'
const SECOND_UNIT = 'unitSECONDAAAAAAAAAA'

beforeAll(async () => { environment = await createTestEnvironment() })
afterAll(async () => environment.cleanup())

function db(uid: string | null): Firestore {
  const context = uid ? environment.authenticatedContext(uid) : environment.unauthenticatedContext()
  return context.firestore() as unknown as Firestore
}

function itemPayload(o: {
  itemId?: string; organizationId?: string; teamId?: string; uid?: string
} = {}) {
  return buildInventoryItemDocument({
    itemId: o.itemId ?? ITEM_LIGHTING,
    organizationId: o.organizationId ?? ORG_A,
    uid: o.uid ?? ADMIN,
    now: serverTimestamp,
    input: {
      name: 'C-Clamp',
      category: 'Hardware',
      teamId: o.teamId ?? TEAM_LIGHTING,
      quantityTotal: 12,
      quantityAvailable: 8,
      conditionCounts: { ...EMPTY_CONDITION_COUNTS, good: 8, needs_repair: 4 },
      location: 'Lighting Storage A',
    },
  })
}

/** The payload the future unit service will send. */
function unitPayload(o: {
  unitId?: string; organizationId?: string; inventoryItemId?: string; teamId?: string
  uid?: string; status?: 'available' | 'in_use' | 'in_maintenance' | 'lost' | 'retired'
  condition?: 'excellent' | 'good' | 'fair' | 'needs_repair' | 'unusable'
  retirementReason?: 'disposed' | 'permanently_lost' | 'donated' | 'sold' | 'other' | null
  usingTeamId?: string | null; usingMemberUid?: string | null
} = {}) {
  return buildInventoryUnitDocument({
    unitId: o.unitId ?? NEW_UNIT,
    organizationId: o.organizationId ?? ORG_A,
    inventoryItemId: o.inventoryItemId ?? ITEM_LIGHTING,
    uid: o.uid ?? ADMIN,
    now: serverTimestamp,
    input: {
      owningTeamId: o.teamId ?? TEAM_LIGHTING,
      assetCode: 'CLAMP-017',
      condition: o.condition ?? 'good',
      status: o.status ?? 'available',
      storageLocation: 'Lighting Storage A',
      retirementReason: o.retirementReason ?? null,
      usingTeamId: o.usingTeamId ?? null,
      usingMemberUid: o.usingMemberUid ?? null,
    },
  })
}

/**
 * A whole-document replace that carries authorship and creation time through,
 * which is what every service in this project sends for an edit.
 */
async function replaceItem(
  itemId: string,
  input: Parameters<typeof buildInventoryItemUpdate>[0]['input'],
) {
  let stored = { created_at: null as unknown as Timestamp, created_by_uid: '' }

  await environment.withSecurityRulesDisabled(async (context) => {
    const store = context.firestore() as unknown as Firestore
    const snapshot = await getDoc(doc(store, 'inventory_items', itemId))
    stored = snapshot.data() as { created_at: Timestamp; created_by_uid: string }
  })

  return buildInventoryItemUpdate({
    itemId,
    organizationId: ORG_A,
    createdByUid: stored.created_by_uid,
    createdAt: stored.created_at,
    now: serverTimestamp,
    input,
  })
}

const BULK_INPUT = {
  name: 'C-Clamp',
  category: 'Hardware',
  teamId: TEAM_LIGHTING,
  trackingMode: 'bulk' as const,
  quantityTotal: 12,
  quantityAvailable: 8,
  conditionCounts: { ...EMPTY_CONDITION_COUNTS, good: 8, needs_repair: 4 },
  location: 'Lighting Storage A',
}

beforeEach(async () => {
  await environment.clearFirestore()

  await seedOrganization(environment, { organizationId: ORG_A, adminUid: ADMIN, code: CODE_A })
  await seedOrganization(environment, { organizationId: ORG_B, adminUid: OUTSIDER, code: CODE_B })

  await seedTeam(environment, { teamId: TEAM_LIGHTING, organizationId: ORG_A, name: 'Lighting' })
  await seedTeam(environment, { teamId: TEAM_COSTUME, organizationId: ORG_A, name: 'Costume' })
  await seedTeam(environment, { teamId: TEAM_OTHER_ORG, organizationId: ORG_B, name: 'Sound' })

  await seedMembership(environment, {
    organizationId: ORG_A, uid: VIEWER, teamIds: [TEAM_LIGHTING], permissions: VIEW_INVENTORY,
  })
  await seedMembership(environment, {
    organizationId: ORG_A, uid: EDITOR, teamIds: [TEAM_LIGHTING], permissions: EDIT_INVENTORY,
  })
  await seedMembership(environment, {
    organizationId: ORG_A, uid: COSTUME_EDITOR, teamIds: [TEAM_COSTUME], permissions: EDIT_INVENTORY,
  })
  await seedMembership(environment, {
    organizationId: ORG_A, uid: BOTH_TEAMS, teamIds: [TEAM_LIGHTING, TEAM_COSTUME],
    permissions: EDIT_INVENTORY,
  })
  await seedMembership(environment, {
    organizationId: ORG_A, uid: NO_ACCESS, teamIds: [TEAM_LIGHTING],
    permissions: { inventory: 'none', maintenance: 'none', productions: 'none', calendar: 'none' },
  })

  await environment.withSecurityRulesDisabled(async (context) => {
    const store = context.firestore() as unknown as Firestore

    await setDoc(doc(store, 'inventory_items', ITEM_LIGHTING), itemPayload())
    await setDoc(doc(store, 'inventory_items', ITEM_COSTUME),
      itemPayload({ itemId: ITEM_COSTUME, teamId: TEAM_COSTUME }))
    await setDoc(doc(store, 'inventory_items', ITEM_OTHER_ORG),
      itemPayload({ itemId: ITEM_OTHER_ORG, organizationId: ORG_B, teamId: TEAM_OTHER_ORG,
        uid: OUTSIDER }))

    await setDoc(doc(store, 'inventory_units', UNIT_LIGHTING), unitPayload({ unitId: UNIT_LIGHTING }))
    await setDoc(doc(store, 'inventory_units', UNIT_COSTUME), unitPayload({
      unitId: UNIT_COSTUME, inventoryItemId: ITEM_COSTUME, teamId: TEAM_COSTUME,
    }))
  })
})

describe('inventory_units — reading', () => {
  it('329. a view member reads any unit in their organization, whatever team owns it', async () => {
    // Reading what the organization owns is not bounded by team; editing is.
    await assertSucceeds(getDoc(doc(db(VIEWER), 'inventory_units', UNIT_LIGHTING)))
    await assertSucceeds(getDoc(doc(db(VIEWER), 'inventory_units', UNIT_COSTUME)))
  })

  it('330. an edit member and the Admin read too', async () => {
    await assertSucceeds(getDoc(doc(db(EDITOR), 'inventory_units', UNIT_COSTUME)))
    await assertSucceeds(getDoc(doc(db(ADMIN), 'inventory_units', UNIT_LIGHTING)))
  })

  it('331. a member without the inventory module reads nothing', async () => {
    await assertFails(getDoc(doc(db(NO_ACCESS), 'inventory_units', UNIT_LIGHTING)))
  })

  it('332. someone outside the organization reads nothing', async () => {
    await assertFails(getDoc(doc(db(OUTSIDER), 'inventory_units', UNIT_LIGHTING)))
  })

  it('333. a signed-out visitor reads nothing', async () => {
    await assertFails(getDoc(doc(db(null), 'inventory_units', UNIT_LIGHTING)))
  })

  it('334. the organization-scoped query succeeds, and another organization does not', async () => {
    await assertSucceeds(getDocs(query(
      collection(db(VIEWER), 'inventory_units'), where('organization_id', '==', ORG_A))))
    await assertFails(getDocs(query(
      collection(db(VIEWER), 'inventory_units'), where('organization_id', '==', ORG_B))))
  })

  it('335. an unfiltered query is rejected', async () => {
    // Rules are not filters: a query that could return another organization's
    // units is refused rather than trimmed.
    await assertFails(getDocs(collection(db(VIEWER), 'inventory_units')))
  })

  it('336. the per-item query succeeds', async () => {
    await assertSucceeds(getDocs(query(
      collection(db(VIEWER), 'inventory_units'),
      where('organization_id', '==', ORG_A),
      where('inventory_item_id', '==', ITEM_LIGHTING))))
  })
})

describe('inventory_units — creating', () => {
  it('337. an edit member creates a unit under their own team', async () => {
    await assertSucceeds(setDoc(doc(db(EDITOR), 'inventory_units', NEW_UNIT),
      unitPayload({ uid: EDITOR })))
  })

  it('338. the Admin creates a unit under any team', async () => {
    await assertSucceeds(setDoc(doc(db(ADMIN), 'inventory_units', NEW_UNIT),
      unitPayload({ inventoryItemId: ITEM_COSTUME, teamId: TEAM_COSTUME })))
  })

  it('339. an edit member cannot create a unit under another team', async () => {
    await assertFails(setDoc(doc(db(COSTUME_EDITOR), 'inventory_units', NEW_UNIT),
      unitPayload({ uid: COSTUME_EDITOR })))
  })

  it('340. a view member cannot create a unit', async () => {
    await assertFails(setDoc(doc(db(VIEWER), 'inventory_units', NEW_UNIT),
      unitPayload({ uid: VIEWER })))
  })

  it('341. a unit may be owned by a team other than its parent\'s', async () => {
    // Lighting's clamps and Scenic's clamps are the same catalog entry and
    // different property. The parent's team is a default at creation, not a
    // claim about every unit under it.
    await assertSucceeds(setDoc(doc(db(ADMIN), 'inventory_units', NEW_UNIT),
      unitPayload({ inventoryItemId: ITEM_LIGHTING, teamId: TEAM_COSTUME })))
  })

  it('341a. two units of one item may be owned by different teams', async () => {
    await assertSucceeds(setDoc(doc(db(ADMIN), 'inventory_units', NEW_UNIT),
      unitPayload({ unitId: NEW_UNIT, inventoryItemId: ITEM_LIGHTING, teamId: TEAM_LIGHTING })))
    await assertSucceeds(setDoc(doc(db(ADMIN), 'inventory_units', SECOND_UNIT),
      unitPayload({ unitId: SECOND_UNIT, inventoryItemId: ITEM_LIGHTING, teamId: TEAM_COSTUME })))
  })

  it('341b. a member cannot own a unit by a team from another organization', async () => {
    // Held to their own memberships, which are per-organization, so a team from
    // elsewhere is not among them.
    await assertFails(setDoc(doc(db(EDITOR), 'inventory_units', NEW_UNIT),
      unitPayload({ inventoryItemId: ITEM_LIGHTING, teamId: TEAM_OTHER_ORG, uid: EDITOR })))
  })

  it('341c. a member cannot own a unit by a team that does not exist', async () => {
    await assertFails(setDoc(doc(db(EDITOR), 'inventory_units', NEW_UNIT),
      unitPayload({ inventoryItemId: ITEM_LIGHTING, teamId: 'teamDOESNOTEXIST0001',
                    uid: EDITOR })))
  })

  it('341e. an owning team must at least be a non-empty string', async () => {
    // What Rules still guarantee for an Admin. That the team exists is checked
    // by the service, which can afford the read a 200-unit batch cannot.
    await assertFails(setDoc(doc(db(ADMIN), 'inventory_units', NEW_UNIT),
      { ...unitPayload({ inventoryItemId: ITEM_LIGHTING }), team_id: '' }))
  })

  it('341d. a member cannot create a unit owned by a team they are not on', async () => {
    await assertFails(setDoc(doc(db(EDITOR), 'inventory_units', NEW_UNIT),
      unitPayload({ inventoryItemId: ITEM_LIGHTING, teamId: TEAM_COSTUME, uid: EDITOR })))
  })

  it('342. a unit pointing at another organization\'s item is refused', async () => {
    await assertFails(setDoc(doc(db(ADMIN), 'inventory_units', NEW_UNIT),
      unitPayload({ inventoryItemId: ITEM_OTHER_ORG, teamId: TEAM_OTHER_ORG })))
  })

  it('343. a unit pointing at an item that does not exist is refused', async () => {
    await assertFails(setDoc(doc(db(ADMIN), 'inventory_units', NEW_UNIT),
      unitPayload({ inventoryItemId: 'itemDOESNOTEXIST0001' })))
  })

  it('344. the document ID must match the unit_id inside', async () => {
    await assertFails(setDoc(doc(db(ADMIN), 'inventory_units', NEW_UNIT),
      unitPayload({ unitId: 'unitSOMETHINGELSE001' })))
  })

  it('345. authorship and creation time cannot be forged', async () => {
    await assertFails(setDoc(doc(db(EDITOR), 'inventory_units', NEW_UNIT),
      { ...unitPayload({ uid: EDITOR }), created_by_uid: ADMIN }))
    await assertFails(setDoc(doc(db(EDITOR), 'inventory_units', NEW_UNIT),
      { ...unitPayload({ uid: EDITOR }), created_at: new Date(2020, 0, 1) }))
  })

  it('346. an unknown field is rejected', async () => {
    await assertFails(setDoc(doc(db(ADMIN), 'inventory_units', NEW_UNIT),
      { ...unitPayload(), qr_token: 'secret' }))
  })
})

describe('inventory_units — status and condition vocabulary', () => {
  it('347. an unsupported status is refused', async () => {
    for (const status of ['broken', 'Available', 'checked_out', '']) {
      await assertFails(setDoc(doc(db(ADMIN), 'inventory_units', NEW_UNIT),
        { ...unitPayload(), status }))
    }
  })

  it('348. an unsupported condition is refused', async () => {
    for (const condition of ['damaged', 'Good', '']) {
      await assertFails(setDoc(doc(db(ADMIN), 'inventory_units', NEW_UNIT),
        { ...unitPayload(), condition }))
    }
  })

  it('349. every documented status and condition is accepted', async () => {
    // Separate documents: writing the same ID twice would be an update, and an
    // update may not restamp created_at.
    const SECOND = 'unitSECONDSECONDSEC1'

    await assertSucceeds(setDoc(doc(db(ADMIN), 'inventory_units', NEW_UNIT),
      unitPayload({ status: 'in_maintenance', condition: 'needs_repair' })))
    await assertSucceeds(setDoc(doc(db(ADMIN), 'inventory_units', SECOND),
      unitPayload({ unitId: SECOND, status: 'lost', condition: 'unusable' })))
  })

  it('350. a retired unit must say why, and only a retired unit may', async () => {
    await assertSucceeds(setDoc(doc(db(ADMIN), 'inventory_units', NEW_UNIT),
      unitPayload({ status: 'retired', retirementReason: 'donated' })))

    // Retired with no reason.
    await assertFails(setDoc(doc(db(ADMIN), 'inventory_units', NEW_UNIT),
      { ...unitPayload({ status: 'retired' }), status: 'retired' }))

    // A reason on a unit that is not retired would outlive the fact it records.
    await assertFails(setDoc(doc(db(ADMIN), 'inventory_units', NEW_UNIT),
      { ...unitPayload(), retirement_reason: 'disposed' }))
  })

  it('351. an unsupported retirement reason is refused', async () => {
    await assertFails(setDoc(doc(db(ADMIN), 'inventory_units', NEW_UNIT),
      { ...unitPayload({ status: 'retired', retirementReason: 'donated' }),
        retirement_reason: 'thrown_away' }))
  })

  it('352. borrowing details belong to a unit that is out, and only that', async () => {
    await assertSucceeds(setDoc(doc(db(ADMIN), 'inventory_units', NEW_UNIT),
      unitPayload({ status: 'in_use', usingTeamId: TEAM_COSTUME })))

    // In use with nobody using it.
    await assertFails(setDoc(doc(db(ADMIN), 'inventory_units', NEW_UNIT),
      { ...unitPayload({ status: 'in_use', usingTeamId: TEAM_COSTUME }), using_team_id: null }))

    // On the shelf but still recorded as borrowed.
    await assertFails(setDoc(doc(db(ADMIN), 'inventory_units', NEW_UNIT),
      { ...unitPayload(), using_team_id: TEAM_COSTUME }))
  })

  it('353. a member cannot be recorded without the team they borrowed for', async () => {
    await assertFails(setDoc(doc(db(ADMIN), 'inventory_units', NEW_UNIT),
      { ...unitPayload({ status: 'in_use', usingTeamId: TEAM_COSTUME }),
        using_team_id: null, using_member_uid: EDITOR }))
  })

  it('353a. an in-use unit cannot name an empty borrowing team', async () => {
    // The field is present, so the status check is satisfied; what it holds
    // says nothing about who has the equipment.
    await assertFails(setDoc(doc(db(ADMIN), 'inventory_units', NEW_UNIT),
      { ...unitPayload({ status: 'in_use', usingTeamId: TEAM_COSTUME }), using_team_id: '' }))
  })

  it('353b. an in-use unit cannot name an empty borrowing member', async () => {
    await assertFails(setDoc(doc(db(ADMIN), 'inventory_units', NEW_UNIT),
      { ...unitPayload({ status: 'in_use', usingTeamId: TEAM_COSTUME }), using_member_uid: '' }))
  })

  it('353c. an in-use unit with a real borrowing team is accepted', async () => {
    await assertSucceeds(setDoc(doc(db(ADMIN), 'inventory_units', NEW_UNIT),
      { ...unitPayload({ status: 'in_use', usingTeamId: TEAM_COSTUME }),
        using_member_uid: EDITOR }))
  })
})

describe('inventory_units — updating', () => {
  it('354. an edit member changes condition on their own team\'s unit', async () => {
    // Condition is an observation about the equipment, not a move: no history
    // is required, and none is written.
    await assertSucceeds(updateDoc(doc(db(EDITOR), 'inventory_units', UNIT_LIGHTING), {
      condition: 'fair',
      updated_at: serverTimestamp(),
    }))
  })

  it('354a. changing status without its history is refused', async () => {
    // From Phase 11C on, a lifecycle move has to name the event that records
    // it. `tests/rules/lifecycle-integrity.test.ts` covers this in full.
    await assertFails(updateDoc(doc(db(EDITOR), 'inventory_units', UNIT_LIGHTING), {
      status: 'in_use',
      using_team_id: TEAM_LIGHTING,
      updated_at: serverTimestamp(),
    }))
  })

  it('355. an edit member cannot touch another team\'s unit', async () => {
    await assertFails(updateDoc(doc(db(COSTUME_EDITOR), 'inventory_units', UNIT_LIGHTING),
      { condition: 'fair', updated_at: serverTimestamp() }))
  })

  it('356. a view member cannot update a unit', async () => {
    await assertFails(updateDoc(doc(db(VIEWER), 'inventory_units', UNIT_LIGHTING),
      { condition: 'fair', updated_at: serverTimestamp() }))
  })

  it('357. an admin may hand a unit to another team', async () => {
    // Ownership changes when equipment changes hands, so it is editable — but
    // it is the field that authorizes edits, so both ends are checked.
    await assertSucceeds(updateDoc(doc(db(ADMIN), 'inventory_units', UNIT_LIGHTING),
      { team_id: TEAM_COSTUME, updated_at: serverTimestamp() }))
  })

  it('357a. a member cannot hand a unit to a team they are not on', async () => {
    // Editable as it stands, not editable where it would be going.
    await assertFails(updateDoc(doc(db(EDITOR), 'inventory_units', UNIT_LIGHTING),
      { team_id: TEAM_COSTUME, updated_at: serverTimestamp() }))
  })

  it('357b. a member on both crews may move a unit between them', async () => {
    await assertSucceeds(updateDoc(doc(db(BOTH_TEAMS), 'inventory_units', UNIT_LIGHTING),
      { team_id: TEAM_COSTUME, updated_at: serverTimestamp() }))
  })

  it('357c. a member cannot move a unit to a team that does not exist', async () => {
    await assertFails(updateDoc(doc(db(EDITOR), 'inventory_units', UNIT_LIGHTING),
      { team_id: 'teamDOESNOTEXIST0001', updated_at: serverTimestamp() }))
  })

  it('357d. a unit cannot be moved to an empty team', async () => {
    await assertFails(updateDoc(doc(db(ADMIN), 'inventory_units', UNIT_LIGHTING),
      { team_id: '', updated_at: serverTimestamp() }))
  })

  it('358. the parent link is immutable', async () => {
    await assertFails(updateDoc(doc(db(ADMIN), 'inventory_units', UNIT_LIGHTING),
      { inventory_item_id: ITEM_COSTUME, updated_at: serverTimestamp() }))
  })

  it('359. identity, organization, and authorship are immutable', async () => {
    await assertFails(updateDoc(doc(db(ADMIN), 'inventory_units', UNIT_LIGHTING),
      { unit_id: NEW_UNIT, updated_at: serverTimestamp() }))
    await assertFails(updateDoc(doc(db(ADMIN), 'inventory_units', UNIT_LIGHTING),
      { organization_id: ORG_B, updated_at: serverTimestamp() }))
    await assertFails(updateDoc(doc(db(ADMIN), 'inventory_units', UNIT_LIGHTING),
      { created_by_uid: EDITOR, updated_at: serverTimestamp() }))
  })

  it('360. updated_at must be the server\'s time', async () => {
    await assertFails(updateDoc(doc(db(ADMIN), 'inventory_units', UNIT_LIGHTING),
      { condition: 'fair', updated_at: new Date(2020, 0, 1) }))
  })
})

describe('inventory_units — deleting', () => {
  it('361. nobody deletes a unit, not even the Admin', async () => {
    // Equipment leaves by being retired, which keeps its history.
    const { deleteDoc } = await import('firebase/firestore')
    await assertFails(deleteDoc(doc(db(ADMIN), 'inventory_units', UNIT_LIGHTING)))
    await assertFails(deleteDoc(doc(db(EDITOR), 'inventory_units', UNIT_LIGHTING)))
  })
})

describe('inventory_items — the serialized contract', () => {
  const SERIAL_ITEM = 'itemSERIALIZEDAAAAA1'

  function serializedItem(o: {
    units?: { status: 'available' | 'in_use' | 'in_maintenance' | 'lost' | 'retired'
              condition: 'excellent' | 'good' | 'fair' | 'needs_repair' | 'unusable' }[]
  } = {}) {
    const units = o.units ?? [
      { status: 'available' as const, condition: 'good' as const },
      { status: 'available' as const, condition: 'unusable' as const },
      { status: 'in_use' as const, condition: 'fair' as const },
    ]
    const counts = unitCountsFrom(units)
    const conditionCounts = { ...EMPTY_CONDITION_COUNTS }
    for (const unit of units) {
      if (unit.status !== 'retired') conditionCounts[unit.condition] += 1
    }

    return buildInventoryItemDocument({
      itemId: SERIAL_ITEM,
      organizationId: ORG_A,
      uid: ADMIN,
      now: serverTimestamp,
      input: {
        name: 'Shure BLX',
        category: 'Microphones',
        teamId: TEAM_LIGHTING,
        trackingMode: 'serialized',
        unitCounts: counts,
        quantityTotal: counts.active_total,
        quantityAvailable: counts.available,
        conditionCounts,
        location: 'Sound Storage',
      },
    })
  }

  it('362. an item with no tracking_mode is still accepted, and is bulk', async () => {
    // Every document currently in Firestore looks like this.
    const legacy = { ...itemPayload({ itemId: SERIAL_ITEM }) } as Record<string, unknown>
    delete legacy.tracking_mode

    await assertSucceeds(setDoc(doc(db(ADMIN), 'inventory_items', SERIAL_ITEM), legacy))
  })

  it('363. an explicit bulk item is accepted and carries no unit_counts', async () => {
    await assertSucceeds(setDoc(doc(db(ADMIN), 'inventory_items', SERIAL_ITEM),
      itemPayload({ itemId: SERIAL_ITEM })))
  })

  it('364. a bulk item may not carry unit_counts', async () => {
    await assertFails(setDoc(doc(db(ADMIN), 'inventory_items', SERIAL_ITEM),
      { ...itemPayload({ itemId: SERIAL_ITEM }), unit_counts: unitCountsFrom([]) }))
  })

  it('365. an unsupported tracking mode is refused', async () => {
    for (const mode of ['individual', 'Serialized', '']) {
      await assertFails(setDoc(doc(db(ADMIN), 'inventory_items', SERIAL_ITEM),
        { ...itemPayload({ itemId: SERIAL_ITEM }), tracking_mode: mode }))
    }
  })

  it('366. a serialized item with consistent mirrors is accepted', async () => {
    await assertSucceeds(setDoc(doc(db(ADMIN), 'inventory_items', SERIAL_ITEM), serializedItem()))
  })

  it('367. a serialized item must carry unit_counts', async () => {
    const payload = { ...serializedItem() } as Record<string, unknown>
    delete payload.unit_counts

    await assertFails(setDoc(doc(db(ADMIN), 'inventory_items', SERIAL_ITEM), payload))
  })

  it('368. unit_counts must add up', async () => {
    // active_total = available + unusable_on_hand + in_use + in_maintenance + lost
    const payload = serializedItem()
    await assertFails(setDoc(doc(db(ADMIN), 'inventory_items', SERIAL_ITEM),
      { ...payload, unit_counts: { ...payload.unit_counts, available: 99 } }))
  })

  it('369. unit_counts rejects a negative bucket and an unknown key', async () => {
    const payload = serializedItem()
    await assertFails(setDoc(doc(db(ADMIN), 'inventory_items', SERIAL_ITEM),
      { ...payload, unit_counts: { ...payload.unit_counts, lost: -1 } }))
    await assertFails(setDoc(doc(db(ADMIN), 'inventory_items', SERIAL_ITEM),
      { ...payload, unit_counts: { ...payload.unit_counts, in_repair: 1 } }))
  })

  it('370. quantity_available must mirror the available count', async () => {
    // This is what keeps production shortage reading the same field it always
    // read, and meaning what the units say.
    const payload = serializedItem()
    await assertFails(setDoc(doc(db(ADMIN), 'inventory_items', SERIAL_ITEM),
      { ...payload, quantity_available: payload.quantity_available + 1 }))
  })

  it('371. quantity_total must mirror the active total', async () => {
    const payload = serializedItem()
    await assertFails(setDoc(doc(db(ADMIN), 'inventory_items', SERIAL_ITEM),
      { ...payload, quantity_total: payload.quantity_total + 5 }))
  })

  it('372. an unusable unit on the shelf is active but not available', async () => {
    // The pair the summary exists to be able to express.
    const payload = serializedItem()

    expect(payload.unit_counts?.active_total).toBe(3)
    expect(payload.quantity_available).toBe(1)
    expect(payload.unit_counts?.unusable_on_hand).toBe(1)
    await assertSucceeds(setDoc(doc(db(ADMIN), 'inventory_items', SERIAL_ITEM), payload))
  })

  it('373. condition counts must account for every active unit', async () => {
    // Every unit carries one condition, so a serialized item has no
    // unclassified remainder — unlike a bulk item.
    const payload = serializedItem()
    await assertFails(setDoc(doc(db(ADMIN), 'inventory_items', SERIAL_ITEM),
      { ...payload, condition_counts: { ...EMPTY_CONDITION_COUNTS, good: 1 } }))
  })

  it('374. a bulk item keeps the looser condition rule', async () => {
    // 12 total, 12 classified is fine; so is leaving some unclassified.
    await assertSucceeds(setDoc(doc(db(ADMIN), 'inventory_items', SERIAL_ITEM),
      { ...itemPayload({ itemId: SERIAL_ITEM }),
        condition_counts: { ...EMPTY_CONDITION_COUNTS, good: 2 } }))
  })

  it('375. promotion from bulk to serialized is allowed', async () => {
    await assertSucceeds(setDoc(doc(db(ADMIN), 'inventory_items', SERIAL_ITEM),
      itemPayload({ itemId: SERIAL_ITEM })))

    // A whole-document replace, which is what an edit sends: creation time and
    // authorship carry through, and only the mode and the mirrors change.
    const promoted = serializedItem()
    await assertSucceeds(setDoc(doc(db(ADMIN), 'inventory_items', SERIAL_ITEM),
      await replaceItem(SERIAL_ITEM, {
        name: 'Shure BLX',
        category: 'Microphones',
        teamId: TEAM_LIGHTING,
        trackingMode: 'serialized',
        unitCounts: promoted.unit_counts,
        quantityTotal: promoted.quantity_total,
        quantityAvailable: promoted.quantity_available,
        conditionCounts: promoted.condition_counts,
        location: 'Sound Storage',
      })))
  })

  it('376. going back from serialized to bulk is refused', async () => {
    // It would strand the unit documents and the history attached to them.
    await assertSucceeds(setDoc(doc(db(ADMIN), 'inventory_items', SERIAL_ITEM), serializedItem()))

    await assertFails(setDoc(doc(db(ADMIN), 'inventory_items', SERIAL_ITEM),
      await replaceItem(SERIAL_ITEM, BULK_INPUT)))
  })

  it('377. an item written before tracking_mode existed may still be edited', async () => {
    const legacy = { ...itemPayload({ itemId: SERIAL_ITEM }) } as Record<string, unknown>
    delete legacy.tracking_mode

    await environment.withSecurityRulesDisabled(async (context) => {
      const store = context.firestore() as unknown as Firestore
      await setDoc(doc(store, 'inventory_items', SERIAL_ITEM), legacy)
    })

    // The next ordinary edit fills the field in, and is not blocked by it.
    await assertSucceeds(updateDoc(doc(db(ADMIN), 'inventory_items', SERIAL_ITEM), {
      location: 'Loft B', tracking_mode: 'bulk', updated_at: serverTimestamp(),
    }))
  })

  it('378. team scope still governs who may write a serialized item', async () => {
    // The item names the Lighting team; a Costume editor may not create it.
    await assertFails(setDoc(doc(db(COSTUME_EDITOR), 'inventory_items', SERIAL_ITEM),
      { ...serializedItem(), created_by_uid: COSTUME_EDITOR }))
  })
})
