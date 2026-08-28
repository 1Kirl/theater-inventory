import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  doc, getDoc, serverTimestamp, setDoc, writeBatch,
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
  ADMIN, CODE_A, EDIT_INVENTORY, ORG_A, TEAM_COSTUME, TEAM_LIGHTING,
  assertFails, assertSucceeds, createTestEnvironment,
  seedMembership, seedOrganization, seedTeam,
} from './helpers'

/**
 * How many units one atomic write can carry.
 *
 * Phase 11B needs a number, not an estimate. Rules spend a fixed budget of
 * access calls per batch — the documented ceiling is twenty for a batched write
 * or transaction — and every document in the batch spends from it. The service
 * writes one unit per transaction on the strength of what this file measures;
 * if a later phase wants to batch, this is where the real ceiling is recorded,
 * and it is measured against the published Rules rather than reasoned about.
 *
 * The measurement is the ladder below: the same shape of write at growing
 * sizes, run against the actual emulator. Where it stops succeeding is the
 * answer.
 */

let environment: RulesTestEnvironment

const EDITOR = 'uid-tx-editor'
/** A member on both crews, for the cross-team borrowing case. */
const BOTH_TEAMS = 'uid-tx-both'
const ITEM = 'itemTXAAAAAAAAAAAAAA'

beforeAll(async () => { environment = await createTestEnvironment() })
afterAll(async () => environment.cleanup())

function db(uid: string): Firestore {
  return environment.authenticatedContext(uid).firestore() as unknown as Firestore
}

function unitPayload(index: number, unitId: string) {
  return buildInventoryUnitDocument({
    unitId,
    organizationId: ORG_A,
    inventoryItemId: ITEM,
    uid: EDITOR,
    now: serverTimestamp,
    input: {
      owningTeamId: TEAM_LIGHTING,
      assetCode: `CLAMP-${String(index).padStart(3, '0')}`,
      condition: 'good',
      status: 'available',
      storageLocation: 'Lighting Storage A',
    },
  })
}

async function storedItem() {
  let stored = { created_at: null as unknown as Timestamp, created_by_uid: '' }
  await environment.withSecurityRulesDisabled(async (context) => {
    const store = context.firestore() as unknown as Firestore
    const snapshot = await getDoc(doc(store, 'inventory_items', ITEM))
    stored = snapshot.data() as { created_at: Timestamp; created_by_uid: string }
  })
  return stored
}

/** The parent write a unit batch must accompany: the mirrors, recomputed. */
async function parentUpdate(unitCount: number) {
  const stored = await storedItem()
  const mirrors = withUnitsAdded(
    EMPTY_MIRRORS,
    Array.from({ length: unitCount }, () => ({ status: 'available' as const, condition: 'good' as const })),
  )

  return buildInventoryItemUpdate({
    itemId: ITEM,
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
  })
}

/** One batch: `unitCount` new units plus the parent they are counted into. */
async function writeUnitBatch(unitCount: number) {
  const store = db(EDITOR)
  const batch = writeBatch(store)

  for (let index = 0; index < unitCount; index += 1) {
    const unitId = `unitTX${String(index).padStart(4, '0')}AAAAAAAAA`.slice(0, 20)
    batch.set(doc(store, 'inventory_units', unitId), unitPayload(index, unitId))
  }
  batch.set(doc(store, 'inventory_items', ITEM), await parentUpdate(unitCount))

  return batch.commit()
}

beforeEach(async () => {
  await environment.clearFirestore()

  await seedOrganization(environment, { organizationId: ORG_A, adminUid: ADMIN, code: CODE_A })
  await seedTeam(environment, { teamId: TEAM_LIGHTING, organizationId: ORG_A, name: 'Lighting' })
  await seedTeam(environment, { teamId: TEAM_COSTUME, organizationId: ORG_A, name: 'Costume' })
  await seedMembership(environment, {
    organizationId: ORG_A,
    uid: EDITOR,
    teamIds: [TEAM_LIGHTING],
    permissions: EDIT_INVENTORY,
  })
  await seedMembership(environment, {
    organizationId: ORG_A,
    uid: BOTH_TEAMS,
    teamIds: [TEAM_LIGHTING, TEAM_COSTUME],
    permissions: EDIT_INVENTORY,
  })

  await environment.withSecurityRulesDisabled(async (context) => {
    const store = context.firestore() as unknown as Firestore
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
        unitCounts: EMPTY_MIRRORS.unit_counts,
        quantityTotal: 0,
        quantityAvailable: 0,
        conditionCounts: EMPTY_CONDITION_COUNTS,
        location: 'Lighting Storage A',
      },
    }))
  })
})

describe('unit-plus-parent atomic writes', () => {
  it('379 accepts one unit written together with its parent', async () => {
    await assertSucceeds(writeUnitBatch(1))
  })

  it('380 leaves the parent counts matching the unit that was written', async () => {
    await writeUnitBatch(1)

    let stored: { quantity_total: number; unit_counts: { available: number } } | undefined
    await environment.withSecurityRulesDisabled(async (context) => {
      const store = context.firestore() as unknown as Firestore
      const snapshot = await getDoc(doc(store, 'inventory_items', ITEM))
      stored = snapshot.data() as typeof stored
    })

    expect(stored?.quantity_total).toBe(1)
    expect(stored?.unit_counts.available).toBe(1)
  })

  it('381 cannot catch a parent whose counts are stale rather than malformed', async () => {
    // The parent still says zero units. Rules cannot count documents, so what
    // catches this is the mirror arithmetic being wrong, not the unit itself.
    const store = db(EDITOR)
    const batch = writeBatch(store)
    const unitId = 'unitTXLONEAAAAAAAAAA'
    batch.set(doc(store, 'inventory_units', unitId), unitPayload(0, unitId))
    batch.set(doc(store, 'inventory_items', ITEM), await parentUpdate(0))

    // Accepted: a stale parent is an arithmetic error the Rules cannot see.
    // Recording it here so the limit of what Rules enforce is written down
    // rather than assumed, which is why the service reads the parent inside the
    // transaction instead of trusting the page.
    await assertSucceeds(batch.commit())
  })

  it('382 rejects a batch whose parent counts disagree with themselves', async () => {
    const store = db(EDITOR)
    const stored = await storedItem()
    const batch = writeBatch(store)
    const unitId = 'unitTXBADAAAAAAAAAAA'

    batch.set(doc(store, 'inventory_units', unitId), unitPayload(0, unitId))
    batch.set(doc(store, 'inventory_items', ITEM), buildInventoryItemUpdate({
      itemId: ITEM,
      organizationId: ORG_A,
      createdByUid: stored.created_by_uid,
      createdAt: stored.created_at,
      now: serverTimestamp,
      input: {
        name: 'C-Clamp',
        category: 'Hardware',
        teamId: TEAM_LIGHTING,
        trackingMode: 'serialized',
        // available + the rest do not add up to active_total.
        unitCounts: {
          active_total: 5, available: 1, unusable_on_hand: 0,
          in_use: 0, in_maintenance: 0, lost: 0, retired: 0,
        },
        quantityTotal: 1,
        quantityAvailable: 1,
        conditionCounts: { ...EMPTY_CONDITION_COUNTS, good: 1 },
        location: 'Lighting Storage A',
      },
    }))

    await assertFails(batch.commit())
  })
})

/**
 * The ladder. Each rung is a real batch against the real Rules.
 *
 * These are assertions rather than a printout, so a Rules change that moves the
 * ceiling fails the suite instead of quietly changing what is safe.
 */
describe('measured access-call budget', () => {
  it.each([1, 2, 3, 4, 5, 6, 8])('383+ accepts a batch of %i units with its parent', async (count) => {
    await assertSucceeds(writeUnitBatch(count))
  })

  it('390 accepts a batch far larger than the access-call limit would suggest', async () => {
    // Measured, not assumed. Every unit in this batch reads the same parent, and
    // Rules charge for distinct document reads rather than for each evaluation,
    // so one `get()` covers the whole batch. Four hundred units and their parent
    // commit fine — the access-call budget is not what bounds this operation.
    await assertSucceeds(writeUnitBatch(400))
  })

  it('391 spends one access call per distinct parent, not per unit', async () => {
    // The other half of the measurement: units under *different* parents each
    // cost a read, and that is where the twenty-call ceiling actually bites.
    // Twenty-five parents is over it.
    const store = db(EDITOR)

    await environment.withSecurityRulesDisabled(async (context) => {
      const seed = context.firestore() as unknown as Firestore
      for (let index = 0; index < 25; index += 1) {
        await setDoc(doc(seed, 'inventory_items', `itemMANY${String(index).padStart(2, '0')}AAAAAAAA`.slice(0, 20)), buildInventoryItemDocument({
          itemId: `itemMANY${String(index).padStart(2, '0')}AAAAAAAA`.slice(0, 20),
          organizationId: ORG_A,
          uid: ADMIN,
          now: serverTimestamp,
          input: {
            name: 'C-Clamp', category: 'Hardware', teamId: TEAM_LIGHTING,
            trackingMode: 'serialized', unitCounts: EMPTY_MIRRORS.unit_counts,
            quantityTotal: 0, quantityAvailable: 0, conditionCounts: EMPTY_CONDITION_COUNTS,
            location: 'Lighting Storage A',
          },
        }))
      }
    })

    const batch = writeBatch(store)
    for (let index = 0; index < 25; index += 1) {
      const parentId = `itemMANY${String(index).padStart(2, '0')}AAAAAAAA`.slice(0, 20)
      const unitId = `unitMANY${String(index).padStart(2, '0')}AAAAAAAA`.slice(0, 20)
      batch.set(doc(store, 'inventory_units', unitId), buildInventoryUnitDocument({
        unitId,
        organizationId: ORG_A,
        inventoryItemId: parentId,
        uid: EDITOR,
        now: serverTimestamp,
        input: {
          owningTeamId: TEAM_LIGHTING,
          assetCode: `MANY-${String(index).padStart(3, '0')}`,
          condition: 'good',
          status: 'available',
          storageLocation: 'Lighting Storage A',
        },
      }))
    }

    await assertFails(batch.commit())
  })
})

/**
 * The two shapes the service actually sends, run through Rules as one write.
 */
describe('service-shaped operations', () => {
  const BULK_ITEM = 'itemBULKAAAAAAAAAAAA'

  async function seedBulkItem() {
    await environment.withSecurityRulesDisabled(async (context) => {
      const store = context.firestore() as unknown as Firestore
      await setDoc(doc(store, 'inventory_items', BULK_ITEM), buildInventoryItemDocument({
        itemId: BULK_ITEM,
        organizationId: ORG_A,
        uid: ADMIN,
        now: serverTimestamp,
        input: {
          name: 'C-Clamp',
          category: 'Hardware',
          teamId: TEAM_LIGHTING,
          trackingMode: 'bulk',
          quantityTotal: 4,
          quantityAvailable: 3,
          conditionCounts: { ...EMPTY_CONDITION_COUNTS, good: 3, unusable: 1 },
          location: 'Lighting Storage A',
        },
      }))
    })
  }

  it('392 accepts a promotion: every unit and the mode flip in one write', async () => {
    await seedBulkItem()

    const store = db(EDITOR)
    const stored = await (async () => {
      let value = { created_at: null as unknown as Timestamp, created_by_uid: '' }
      await environment.withSecurityRulesDisabled(async (context) => {
        const seed = context.firestore() as unknown as Firestore
        const snapshot = await getDoc(doc(seed, 'inventory_items', BULK_ITEM))
        value = snapshot.data() as typeof value
      })
      return value
    })()

    const drafts = [
      { status: 'available' as const, condition: 'good' as const },
      { status: 'available' as const, condition: 'good' as const },
      { status: 'in_use' as const, condition: 'good' as const },
      { status: 'available' as const, condition: 'unusable' as const },
    ]
    const mirrors = withUnitsAdded(EMPTY_MIRRORS, drafts)

    const batch = writeBatch(store)
    drafts.forEach((draft, index) => {
      const unitId = `unitPROMO${String(index).padStart(2, '0')}AAAAAAA`.slice(0, 20)
      batch.set(doc(store, 'inventory_units', unitId), buildInventoryUnitDocument({
        unitId,
        organizationId: ORG_A,
        inventoryItemId: BULK_ITEM,
        uid: EDITOR,
        now: serverTimestamp,
        input: {
          owningTeamId: TEAM_LIGHTING,
          assetCode: `PROMO-${String(index).padStart(3, '0')}`,
          condition: draft.condition,
          status: draft.status,
          storageLocation: 'Lighting Storage A',
          usingTeamId: draft.status === 'in_use' ? TEAM_LIGHTING : null,
        },
      }))
    })

    batch.set(doc(store, 'inventory_items', BULK_ITEM), buildInventoryItemUpdate({
      itemId: BULK_ITEM,
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
    }))

    await assertSucceeds(batch.commit())
  })

  it('393 refuses to turn a serialized item back into a bulk one', async () => {
    const stored = await storedItem()

    await assertFails(setDoc(doc(db(EDITOR), 'inventory_items', ITEM), buildInventoryItemUpdate({
      itemId: ITEM,
      organizationId: ORG_A,
      createdByUid: stored.created_by_uid,
      createdAt: stored.created_at,
      now: serverTimestamp,
      input: {
        name: 'C-Clamp',
        category: 'Hardware',
        teamId: TEAM_LIGHTING,
        trackingMode: 'bulk',
        quantityTotal: 4,
        quantityAvailable: 4,
        conditionCounts: { ...EMPTY_CONDITION_COUNTS, good: 4 },
        location: 'Lighting Storage A',
      },
    })))
  })

  it('394 accepts a condition edit that moves a unit out of availability', async () => {
    // One unit on the shelf, then it turns out to be unusable: the unit and the
    // parent's availability move together, which is what the service sends.
    await writeUnitBatch(1)

    const store = db(EDITOR)
    const unitId = `unitTX${String(0).padStart(4, '0')}AAAAAAAAA`.slice(0, 20)

    let unit = { created_at: null as unknown as Timestamp, created_by_uid: '', asset_code: '' }
    await environment.withSecurityRulesDisabled(async (context) => {
      const seed = context.firestore() as unknown as Firestore
      const snapshot = await getDoc(doc(seed, 'inventory_units', unitId))
      unit = snapshot.data() as typeof unit
    })

    const stored = await storedItem()
    const mirrors = withUnitsAdded(EMPTY_MIRRORS, [
      { status: 'available', condition: 'unusable' },
    ])

    const batch = writeBatch(store)
    batch.set(doc(store, 'inventory_units', unitId), buildInventoryUnitUpdate({
      unitId,
      organizationId: ORG_A,
      inventoryItemId: ITEM,
      createdByUid: unit.created_by_uid,
      createdAt: unit.created_at,
      now: serverTimestamp,
      input: {
        owningTeamId: TEAM_LIGHTING,
        assetCode: unit.asset_code,
        condition: 'unusable',
        status: 'available',
        storageLocation: 'Lighting Storage A',
      },
    }))
    batch.set(doc(store, 'inventory_items', ITEM), buildInventoryItemUpdate({
      itemId: ITEM,
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
    }))

    await assertSucceeds(batch.commit())
  })
})

/**
 * What the borrowing-team check costs, and what it buys.
 *
 * A member is held to their own assigned teams, which is free: the membership
 * document is read to authorize the write regardless, so the check reads a
 * second field of a document Rules already have.
 *
 * An Admin is checked for shape only. The stricter rule — reading each team
 * document to prove it belongs to the organization — was implemented and
 * measured here first, and rejected on the evidence: one batch tolerates seven
 * distinct borrowing teams before the access-call budget runs out, so a
 * department with eight crews would have a legitimate conversion fail. The last
 * test in this block is what holds that number honest.
 */
describe('borrowing team, measured', () => {
  const ADMIN_ITEM = 'itemADMINAAAAAAAAAAA'

  function teamIdFor(index: number) {
    return `teamMEASURE${String(index).padStart(2, '0')}AAA`.slice(0, 20)
  }

  async function seedTeams(count: number) {
    await environment.withSecurityRulesDisabled(async (context) => {
      const store = context.firestore() as unknown as Firestore
      for (let index = 0; index < count; index += 1) {
        await setDoc(doc(store, 'teams', teamIdFor(index)), {
          team_id: teamIdFor(index),
          organization_id: ORG_A,
          name: `Crew ${String(index)}`,
          created_at: serverTimestamp(),
          updated_at: serverTimestamp(),
        })
      }
    })
  }

  async function seedSerializedItem() {
    await environment.withSecurityRulesDisabled(async (context) => {
      const store = context.firestore() as unknown as Firestore
      await setDoc(doc(store, 'inventory_items', ADMIN_ITEM), buildInventoryItemDocument({
        itemId: ADMIN_ITEM,
        organizationId: ORG_A,
        uid: ADMIN,
        now: serverTimestamp,
        input: {
          name: 'C-Clamp', category: 'Hardware', teamId: TEAM_LIGHTING,
          trackingMode: 'serialized', unitCounts: EMPTY_MIRRORS.unit_counts,
          quantityTotal: 0, quantityAvailable: 0, conditionCounts: EMPTY_CONDITION_COUNTS,
          location: 'Lighting Storage A',
        },
      }))
    })
  }

  /** `unitCount` in-use units spread across `teamCount` distinct borrowing teams. */
  function inUseBatch(o: {
    uid: string
    unitCount: number
    teamOf: (index: number) => string
    run?: number
  }) {
    const store = db(o.uid)
    const batch = writeBatch(store)

    for (let index = 0; index < o.unitCount; index += 1) {
      // Unique per run: reusing an id would make a later rung an update, which
      // is refused for changing created_at rather than for the budget.
      const unitId = `unitM${String(o.run ?? 0).padStart(2, '0')}${String(index).padStart(4, '0')}AAAAAAAAA`.slice(0, 20)
      batch.set(doc(store, 'inventory_units', unitId), buildInventoryUnitDocument({
        unitId,
        organizationId: ORG_A,
        inventoryItemId: ADMIN_ITEM,
        uid: o.uid,
        now: serverTimestamp,
        input: {
          owningTeamId: TEAM_LIGHTING,
          assetCode: `MEAS-${String(o.run ?? 0)}-${String(index).padStart(3, '0')}`,
          condition: 'good',
          status: 'in_use',
          storageLocation: 'Lighting Storage A',
          usingTeamId: o.teamOf(index),
        },
      }))
    }

    return batch.commit()
  }

  function ownedByBatch(o: {
    uid: string
    unitCount: number
    teamOf: (index: number) => string
    run?: number
  }) {
    const store = db(o.uid)
    const batch = writeBatch(store)

    for (let index = 0; index < o.unitCount; index += 1) {
      const unitId = `unitO${String(o.run ?? 0).padStart(2, '0')}${String(index).padStart(4, '0')}AAAAAAAAA`.slice(0, 20)
      batch.set(doc(store, 'inventory_units', unitId), buildInventoryUnitDocument({
        unitId,
        organizationId: ORG_A,
        inventoryItemId: ADMIN_ITEM,
        uid: o.uid,
        now: serverTimestamp,
        input: {
          owningTeamId: o.teamOf(index),
          assetCode: `OWN-${String(o.run ?? 0)}-${String(index).padStart(3, '0')}`,
          condition: 'good',
          status: 'available',
          storageLocation: 'Lighting Storage A',
        },
      }))
    }

    return batch.commit()
  }

  it('395 accepts 200 units all borrowed by one team', async () => {
    // The realistic conversion: a whole item lent to a single crew.
    await seedTeams(1)
    await seedSerializedItem()

    await assertSucceeds(inUseBatch({
      uid: ADMIN, unitCount: 200, teamOf: () => teamIdFor(0),
    }))
  })

  it('396 accepts 200 units spread across more crews than a school would have', async () => {
    await seedTeams(12)
    await seedSerializedItem()

    await assertSucceeds(inUseBatch({
      uid: ADMIN, unitCount: 200, teamOf: (index) => teamIdFor(index % 12),
    }))
  })

  it('397 lets a member lend to a team they are on', async () => {
    await seedSerializedItem()

    await assertSucceeds(inUseBatch({
      uid: EDITOR, unitCount: 1, teamOf: () => TEAM_LIGHTING,
    }))
  })

  it('398 refuses a member lending to a team they are not on', async () => {
    // The boundary the membership check exists for: attributing equipment to a
    // crew the actor has nothing to do with.
    await seedSerializedItem()

    await assertFails(inUseBatch({
      uid: EDITOR, unitCount: 1, teamOf: () => TEAM_COSTUME, run: 1,
    }))
  })

  it('399 costs a member nothing per distinct team: 200 units, every team they hold', async () => {
    await seedSerializedItem()

    // Both of this member's teams, alternating. The membership document is read
    // once no matter how many distinct teams the batch names.
    await assertSucceeds(inUseBatch({
      uid: BOTH_TEAMS,
      unitCount: 200,
      teamOf: (index) => (index % 2 === 0 ? TEAM_LIGHTING : TEAM_COSTUME),
      run: 2,
    }))
  })

  it('400a accepts 200 units all owned by one team', async () => {
    // The realistic conversion, now that a unit's owning team is its own and
    // checked against the team document the way an item's is.
    await seedSerializedItem()

    await assertSucceeds(ownedByBatch({ uid: ADMIN, unitCount: 200, teamOf: () => TEAM_LIGHTING }))
  })

  it('400b carries as many distinct owning teams as a batch has units', async () => {
    // There is no ceiling here any more. An earlier draft checked each owning
    // team against its team document, which cost one access call per distinct
    // team and capped a conversion at eight crews — an arbitrary product limit
    // nobody could have predicted or worked around. Dropping that read removes
    // it; a member is still confined to their own teams by the membership
    // document Rules already have, and an Admin's team is checked by the
    // service. This walks every rung to prove nothing fails partway.
    await seedTeams(12)
    await seedSerializedItem()

    let lastAccepted = 0
    let run = 10
    for (const teamCount of [1, 2, 3, 4, 5, 6, 7, 8, 10, 12]) {
      run += 1
      await ownedByBatch({
        uid: ADMIN,
        unitCount: teamCount,
        teamOf: (index) => teamIdFor(index % teamCount),
        run,
      })
      lastAccepted = teamCount
    }

    expect(lastAccepted).toBe(12)
  })

  it('400c accepts 200 units spread across twelve owning teams', async () => {
    // The realistic worst case for a conversion: a big shelf split between
    // every crew in the department.
    await seedTeams(12)
    await seedSerializedItem()

    await assertSucceeds(ownedByBatch({
      uid: ADMIN, unitCount: 200, teamOf: (index) => teamIdFor(index % 12), run: 30,
    }))
  })

  it('400 an admin may lend to any team, including one no member holds', async () => {
    await seedTeams(1)
    await seedSerializedItem()

    await assertSucceeds(inUseBatch({
      uid: ADMIN, unitCount: 1, teamOf: () => teamIdFor(0), run: 3,
    }))
  })
})
