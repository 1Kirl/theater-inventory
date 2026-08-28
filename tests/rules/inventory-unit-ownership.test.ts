import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  doc, getDoc, serverTimestamp, setDoc, updateDoc, writeBatch,
  type Firestore,
  type Timestamp,
} from 'firebase/firestore'
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { buildInventoryItemDocument, buildInventoryItemUpdate } from '@/domain/inventory-payloads'
import {
  buildInventoryUnitDocument, buildInventoryUnitUpdate,
} from '@/domain/inventory-unit-payloads'
import { EMPTY_CONDITION_COUNTS } from '@/domain/inventory'
import { EMPTY_MIRRORS, withUnitsAdded } from '@/domain/inventory-unit'
import {
  ADMIN, CODE_A, EDIT_INVENTORY, ORG_A, OUTSIDER, TEAM_COSTUME, TEAM_LIGHTING, VIEW_INVENTORY,
  assertFails, assertSucceeds, createTestEnvironment,
  seedMembership, seedOrganization, seedTeam,
} from './helpers'

/**
 * Who may edit a unit, and what that costs the item above it.
 *
 * A serialized item's team is a catalog default, not a claim on the equipment.
 * Scenic's clamp under a Lighting-owned item belongs to Scenic, and Scenic has
 * to be able to record that it broke — which means writing the item's mirrors,
 * because the numbers are counted from the units.
 */

let environment: RulesTestEnvironment

/** Scenic only. The crew whose clamp it is. */
const SCENIC_EDITOR = 'uid-own-scenic'
/** Lighting only. Owns the catalog entry, not this unit. */
const LIGHTING_EDITOR = 'uid-own-lighting'
const BOTH_TEAMS = 'uid-own-both'
/** Inventory view only: may read the numbers, not move them. */
const VIEWER = 'uid-own-viewer'

const ITEM_SERIALIZED = 'itemOWNSERIALAAAAAAA'
const ITEM_BULK = 'itemOWNBULKAAAAAAAAA'
const UNIT_SCENIC = 'unitOWNSCENICAAAAAAA'
const UNIT_LIGHTING = 'unitOWNLIGHTINGAAAAA'

beforeAll(async () => { environment = await createTestEnvironment() })
afterAll(async () => environment.cleanup())

function db(uid: string): Firestore {
  return environment.authenticatedContext(uid).firestore() as unknown as Firestore
}

/** Two units: one Scenic's, one Lighting's, both under a Lighting-owned item. */
const UNITS = [
  { status: 'available' as const, condition: 'good' as const },
  { status: 'available' as const, condition: 'good' as const },
]

async function storedUnit(unitId: string) {
  let stored = { created_at: null as unknown as Timestamp, created_by_uid: '' }
  await environment.withSecurityRulesDisabled(async (context) => {
    const store = context.firestore() as unknown as Firestore
    const snapshot = await getDoc(doc(store, 'inventory_units', unitId))
    stored = snapshot.data() as typeof stored
  })
  return stored
}

async function storedItem(itemId: string) {
  let stored = { created_at: null as unknown as Timestamp, created_by_uid: '' }
  await environment.withSecurityRulesDisabled(async (context) => {
    const store = context.firestore() as unknown as Firestore
    const snapshot = await getDoc(doc(store, 'inventory_items', itemId))
    stored = snapshot.data() as typeof stored
  })
  return stored
}

/** The item write a unit's condition change carries with it. */
async function mirrorUpdate(o: {
  conditions: readonly ('good' | 'unusable')[]
  overrides?: Record<string, unknown>
}) {
  const stored = await storedItem(ITEM_SERIALIZED)
  const mirrors = withUnitsAdded(
    EMPTY_MIRRORS,
    o.conditions.map((condition) => ({ status: 'available' as const, condition })),
  )

  return {
    ...buildInventoryItemUpdate({
      itemId: ITEM_SERIALIZED,
      organizationId: ORG_A,
      createdByUid: stored.created_by_uid,
      createdAt: stored.created_at,
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
    }),
    ...(o.overrides ?? {}),
  }
}

beforeEach(async () => {
  await environment.clearFirestore()

  await seedOrganization(environment, { organizationId: ORG_A, adminUid: ADMIN, code: CODE_A })
  await seedTeam(environment, { teamId: TEAM_LIGHTING, organizationId: ORG_A, name: 'Lighting' })
  await seedTeam(environment, { teamId: TEAM_COSTUME, organizationId: ORG_A, name: 'Scenic' })

  await seedMembership(environment, {
    organizationId: ORG_A, uid: SCENIC_EDITOR, teamIds: [TEAM_COSTUME],
    permissions: EDIT_INVENTORY,
  })
  await seedMembership(environment, {
    organizationId: ORG_A, uid: LIGHTING_EDITOR, teamIds: [TEAM_LIGHTING],
    permissions: EDIT_INVENTORY,
  })
  await seedMembership(environment, {
    organizationId: ORG_A, uid: BOTH_TEAMS, teamIds: [TEAM_LIGHTING, TEAM_COSTUME],
    permissions: EDIT_INVENTORY,
  })
  await seedMembership(environment, {
    organizationId: ORG_A, uid: VIEWER, teamIds: [TEAM_COSTUME], permissions: VIEW_INVENTORY,
  })

  await environment.withSecurityRulesDisabled(async (context) => {
    const store = context.firestore() as unknown as Firestore
    const mirrors = withUnitsAdded(EMPTY_MIRRORS, UNITS)

    // A serialized item owned, as a catalog entry, by Lighting.
    await setDoc(doc(store, 'inventory_items', ITEM_SERIALIZED), buildInventoryItemDocument({
      itemId: ITEM_SERIALIZED,
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

    // An ordinary bulk item, to prove nothing about it changed.
    await setDoc(doc(store, 'inventory_items', ITEM_BULK), buildInventoryItemDocument({
      itemId: ITEM_BULK,
      organizationId: ORG_A,
      uid: ADMIN,
      now: serverTimestamp,
      input: {
        name: 'Gel Frame',
        category: 'Hardware',
        teamId: TEAM_LIGHTING,
        trackingMode: 'bulk',
        quantityTotal: 10,
        quantityAvailable: 10,
        conditionCounts: { ...EMPTY_CONDITION_COUNTS, good: 10 },
        location: 'Lighting Storage A',
      },
    }))

    for (const [unitId, teamId] of [
      [UNIT_SCENIC, TEAM_COSTUME], [UNIT_LIGHTING, TEAM_LIGHTING],
    ] as const) {
      await setDoc(doc(store, 'inventory_units', unitId), buildInventoryUnitDocument({
        unitId,
        organizationId: ORG_A,
        inventoryItemId: ITEM_SERIALIZED,
        uid: ADMIN,
        now: serverTimestamp,
        input: {
          assetCode: unitId,
          owningTeamId: teamId,
          condition: 'good',
          status: 'available',
          storageLocation: 'Storage',
        },
      }))
    }
  })
})

describe('a unit owner works across the parent item\'s team', () => {
  it('418 lets a Scenic editor record that their Scenic unit became unusable', async () => {
    // The whole point. The parent item is Lighting's catalog entry; the clamp
    // is Scenic's, and the numbers on the item are counted from units like it.
    const store = db(SCENIC_EDITOR)
    const batch = writeBatch(store)

    batch.update(doc(store, 'inventory_units', UNIT_SCENIC), {
      condition: 'unusable',
      updated_at: serverTimestamp(),
    })
    batch.set(
      doc(store, 'inventory_items', ITEM_SERIALIZED),
      await mirrorUpdate({ conditions: ['good', 'unusable'] }),
    )

    await assertSucceeds(batch.commit())
  })

  it('418a lets a Scenic editor add a Scenic unit under a Lighting item', async () => {
    // Creating a unit moves the same mirrors, so it travels the same path.
    const store = db(SCENIC_EDITOR)
    const batch = writeBatch(store)
    const unitId = 'unitOWNNEWAAAAAAAAAA'

    batch.set(doc(store, 'inventory_units', unitId), buildInventoryUnitDocument({
      unitId,
      organizationId: ORG_A,
      inventoryItemId: ITEM_SERIALIZED,
      uid: SCENIC_EDITOR,
      now: serverTimestamp,
      input: {
        assetCode: 'CLAMP-003',
        owningTeamId: TEAM_COSTUME,
        condition: 'good',
        status: 'available',
        storageLocation: 'Scene Shop',
      },
    }))
    batch.set(
      doc(store, 'inventory_items', ITEM_SERIALIZED),
      await mirrorUpdate({ conditions: ['good', 'good', 'good'] }),
    )

    await assertSucceeds(batch.commit())
  })

  it('418b does not let an editor with view-only inventory move the mirrors', async () => {
    await assertFails(setDoc(
      doc(db(VIEWER), 'inventory_items', ITEM_SERIALIZED),
      await mirrorUpdate({ conditions: ['good', 'unusable'] }),
    ))
  })

  it('418c does not let a member of no team move the mirrors', async () => {
    // The path asks for an active membership with inventory edit, not for a
    // particular team — but it still asks.
    await assertFails(setDoc(
      doc(db(OUTSIDER), 'inventory_items', ITEM_SERIALIZED),
      await mirrorUpdate({ conditions: ['good', 'unusable'] }),
    ))
  })

  it('419 does not let a Scenic editor touch a Lighting-owned unit', async () => {
    await assertFails(updateDoc(doc(db(SCENIC_EDITOR), 'inventory_units', UNIT_LIGHTING), {
      condition: 'unusable',
      updated_at: serverTimestamp(),
    }))
  })

  it('420 does not let a Scenic editor rename the parent item', async () => {
    // The mirror path is for the numbers a unit operation moves, nothing else.
    await assertFails(setDoc(
      doc(db(SCENIC_EDITOR), 'inventory_items', ITEM_SERIALIZED),
      await mirrorUpdate({ conditions: ['good', 'good'], overrides: { name: 'Renamed' } }),
    ))
  })

  it('421 does not let a Scenic editor move the parent item to another team', async () => {
    await assertFails(setDoc(
      doc(db(SCENIC_EDITOR), 'inventory_items', ITEM_SERIALIZED),
      await mirrorUpdate({ conditions: ['good', 'good'], overrides: { team_id: TEAM_COSTUME } }),
    ))
  })

  it('422 does not let a Scenic editor change the parent item\'s location', async () => {
    await assertFails(setDoc(
      doc(db(SCENIC_EDITOR), 'inventory_items', ITEM_SERIALIZED),
      await mirrorUpdate({ conditions: ['good', 'good'], overrides: { location: 'Scene Shop' } }),
    ))
  })

  it('423 does not let a Scenic editor turn the item back into a bulk one', async () => {
    const stored = await storedItem(ITEM_SERIALIZED)

    await assertFails(setDoc(
      doc(db(SCENIC_EDITOR), 'inventory_items', ITEM_SERIALIZED),
      buildInventoryItemUpdate({
        itemId: ITEM_SERIALIZED,
        organizationId: ORG_A,
        createdByUid: stored.created_by_uid,
        createdAt: stored.created_at,
        now: serverTimestamp,
        input: {
          name: 'C-Clamp',
          category: 'Hardware',
          teamId: TEAM_LIGHTING,
          trackingMode: 'bulk',
          quantityTotal: 2,
          quantityAvailable: 2,
          conditionCounts: { ...EMPTY_CONDITION_COUNTS, good: 2 },
          location: 'Lighting Storage A',
        },
      }),
    ))
  })

  it('424 still lets the parent item\'s own team edit its metadata', async () => {
    const stored = await storedItem(ITEM_SERIALIZED)

    await assertSucceeds(setDoc(
      doc(db(LIGHTING_EDITOR), 'inventory_items', ITEM_SERIALIZED),
      buildInventoryItemUpdate({
        itemId: ITEM_SERIALIZED,
        organizationId: ORG_A,
        createdByUid: stored.created_by_uid,
        createdAt: stored.created_at,
        now: serverTimestamp,
        input: {
          name: 'C-Clamp (renamed)',
          category: 'Hardware',
          teamId: TEAM_LIGHTING,
          trackingMode: 'serialized',
          unitCounts: withUnitsAdded(EMPTY_MIRRORS, UNITS).unit_counts,
          quantityTotal: 2,
          quantityAvailable: 2,
          conditionCounts: { ...EMPTY_CONDITION_COUNTS, good: 2 },
          location: 'Lighting Storage A',
        },
      }),
    ))
  })
})

describe('handing a unit to another crew', () => {
  it('427 a member on both crews may move their unit between them', async () => {
    await assertSucceeds(updateDoc(doc(db(BOTH_TEAMS), 'inventory_units', UNIT_SCENIC), {
      team_id: TEAM_LIGHTING,
      updated_at: serverTimestamp(),
    }))
  })

  it('428 a Scenic-only member cannot hand their unit to Lighting', async () => {
    // Editable as it stands, not editable where it would be going.
    await assertFails(updateDoc(doc(db(SCENIC_EDITOR), 'inventory_units', UNIT_SCENIC), {
      team_id: TEAM_LIGHTING,
      updated_at: serverTimestamp(),
    }))
  })

  it('429 an admin may hand a unit to any team in the organization', async () => {
    await assertSucceeds(updateDoc(doc(db(ADMIN), 'inventory_units', UNIT_SCENIC), {
      team_id: TEAM_LIGHTING,
      updated_at: serverTimestamp(),
    }))
  })

  it('430a an admin transfer in the shape the service actually sends', async () => {
    // 427-429 use updateDoc, which sends a handful of fields. The service sends
    // the whole document through buildInventoryUnitUpdate, and `hasExactly`
    // makes that a different write to validate. This is the operation the
    // browser performs.
    const stored = await storedUnit(UNIT_LIGHTING)

    await assertSucceeds(setDoc(
      doc(db(ADMIN), 'inventory_units', UNIT_LIGHTING),
      buildInventoryUnitUpdate({
        unitId: UNIT_LIGHTING,
        organizationId: ORG_A,
        inventoryItemId: ITEM_SERIALIZED,
        createdByUid: stored.created_by_uid,
        createdAt: stored.created_at,
        now: serverTimestamp,
        input: {
          assetCode: UNIT_LIGHTING,
          owningTeamId: TEAM_COSTUME,
          condition: 'good',
          status: 'available',
          storageLocation: 'Storage',
        },
      }),
    ))
  })

  it('430b an admin transfer that also moves the parent mirrors, in one write', async () => {
    // Changing the team and the condition together is the case where the
    // service writes both documents in a single transaction.
    const stored = await storedUnit(UNIT_LIGHTING)
    const store = db(ADMIN)
    const batch = writeBatch(store)

    batch.set(doc(store, 'inventory_units', UNIT_LIGHTING), buildInventoryUnitUpdate({
      unitId: UNIT_LIGHTING,
      organizationId: ORG_A,
      inventoryItemId: ITEM_SERIALIZED,
      createdByUid: stored.created_by_uid,
      createdAt: stored.created_at,
      now: serverTimestamp,
      input: {
        assetCode: UNIT_LIGHTING,
        owningTeamId: TEAM_COSTUME,
        condition: 'unusable',
        status: 'available',
        storageLocation: 'Storage',
      },
    }))
    batch.set(
      doc(store, 'inventory_items', ITEM_SERIALIZED),
      await mirrorUpdate({ conditions: ['good', 'unusable'] }),
    )

    await assertSucceeds(batch.commit())
  })

  it('430c the same transfer, by a member holding both crews', async () => {
    const stored = await storedUnit(UNIT_LIGHTING)

    await assertSucceeds(setDoc(
      doc(db(BOTH_TEAMS), 'inventory_units', UNIT_LIGHTING),
      buildInventoryUnitUpdate({
        unitId: UNIT_LIGHTING,
        organizationId: ORG_A,
        inventoryItemId: ITEM_SERIALIZED,
        createdByUid: stored.created_by_uid,
        createdAt: stored.created_at,
        now: serverTimestamp,
        input: {
          assetCode: UNIT_LIGHTING,
          owningTeamId: TEAM_COSTUME,
          condition: 'good',
          status: 'available',
          storageLocation: 'Storage',
        },
      }),
    ))
  })

  it('430 ownership does not follow the parent item\'s team', async () => {
    // Moving the item's catalog team leaves every unit where it was.
    const stored = await storedItem(ITEM_SERIALIZED)

    await assertSucceeds(setDoc(
      doc(db(ADMIN), 'inventory_items', ITEM_SERIALIZED),
      buildInventoryItemUpdate({
        itemId: ITEM_SERIALIZED,
        organizationId: ORG_A,
        createdByUid: stored.created_by_uid,
        createdAt: stored.created_at,
        now: serverTimestamp,
        input: {
          name: 'C-Clamp',
          category: 'Hardware',
          teamId: TEAM_COSTUME,
          trackingMode: 'serialized',
          unitCounts: withUnitsAdded(EMPTY_MIRRORS, UNITS).unit_counts,
          quantityTotal: 2,
          quantityAvailable: 2,
          conditionCounts: { ...EMPTY_CONDITION_COUNTS, good: 2 },
          location: 'Lighting Storage A',
        },
      }),
    ))

    let unit: { team_id: string } | undefined
    await environment.withSecurityRulesDisabled(async (context) => {
      const store = context.firestore() as unknown as Firestore
      const snapshot = await getDoc(doc(store, 'inventory_units', UNIT_LIGHTING))
      unit = snapshot.data() as typeof unit
    })

    expect(unit?.team_id).toBe(TEAM_LIGHTING)
  })
})

describe('bulk items are untouched by any of this', () => {
  it('425 a Scenic editor cannot change a Lighting bulk item\'s quantities', async () => {
    const stored = await storedItem(ITEM_BULK)

    await assertFails(setDoc(
      doc(db(SCENIC_EDITOR), 'inventory_items', ITEM_BULK),
      buildInventoryItemUpdate({
        itemId: ITEM_BULK,
        organizationId: ORG_A,
        createdByUid: stored.created_by_uid,
        createdAt: stored.created_at,
        now: serverTimestamp,
        input: {
          name: 'Gel Frame',
          category: 'Hardware',
          teamId: TEAM_LIGHTING,
          trackingMode: 'bulk',
          quantityTotal: 10,
          quantityAvailable: 4,
          conditionCounts: { ...EMPTY_CONDITION_COUNTS, good: 10 },
          location: 'Lighting Storage A',
        },
      }),
    ))
  })

  it('426 the parent item\'s own team still edits a bulk item as before', async () => {
    const stored = await storedItem(ITEM_BULK)

    await assertSucceeds(setDoc(
      doc(db(LIGHTING_EDITOR), 'inventory_items', ITEM_BULK),
      buildInventoryItemUpdate({
        itemId: ITEM_BULK,
        organizationId: ORG_A,
        createdByUid: stored.created_by_uid,
        createdAt: stored.created_at,
        now: serverTimestamp,
        input: {
          name: 'Gel Frame',
          category: 'Hardware',
          teamId: TEAM_LIGHTING,
          trackingMode: 'bulk',
          quantityTotal: 10,
          quantityAvailable: 4,
          conditionCounts: { ...EMPTY_CONDITION_COUNTS, good: 10 },
          location: 'Lighting Storage A',
        },
      }),
    ))
  })
})
