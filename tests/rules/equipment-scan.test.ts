import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  doc, getDoc, serverTimestamp, setDoc,
  type Firestore,
} from 'firebase/firestore'
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { buildInventoryItemDocument } from '@/domain/inventory-payloads'
import { buildInventoryUnitDocument } from '@/domain/inventory-unit-payloads'
import { EMPTY_CONDITION_COUNTS } from '@/domain/inventory'
import {
  ADMIN, CODE_A, CODE_B, EDIT_INVENTORY, ORG_A, ORG_B, OUTSIDER, TEAM_LIGHTING, TEAM_OTHER_ORG,
  VIEW_INVENTORY, assertFails, assertSucceeds, createTestEnvironment,
  seedMembership, seedOrganization, seedTeam,
} from './helpers'

/**
 * Phase 11E: what a scanned QR label may open.
 *
 * A printed label is the least controlled thing this product produces. It is
 * stuck to equipment that leaves the building, it is photographed, and the URL
 * on it can be typed by anyone. So the question these tests answer is not what
 * the interface shows — it is what Firestore hands over when an arbitrary
 * person opens `/equipment/<id>`.
 *
 * The link carries no credential of any kind. Everything below therefore rests
 * on the unit document's own `organization_id` and the reader's membership.
 */

let environment: RulesTestEnvironment

const OWNER_VIEWER = 'uid-scan-viewer'
const OWNER_EDITOR = 'uid-scan-editor'
const NO_INVENTORY = 'uid-scan-no-inventory'
/** In both organizations, which is the whole point of the multi-org deep link. */
const IN_BOTH = 'uid-scan-both'
/** Signed in, but in neither organization. */
const STRANGER = 'uid-scan-stranger'
/**
 * In both organizations, with inventory access in only one of them. This is
 * the person the Phase 11E routing exception exists for: a guard bound to
 * whichever organization is currently open would refuse them.
 */
const SPLIT_ACCESS = 'uid-scan-split'

const ITEM_A = 'itemSCANAAAAAAAAAAAA'
const ITEM_B = 'itemSCANBBBBBBBBBBBB'
const UNIT_A = 'unitSCANAAAAAAAAAAAA'
const UNIT_B = 'unitSCANBBBBBBBBBBBB'
const NEVER_EXISTED = 'unitNOSUCHTHINGAAAAA'

beforeAll(async () => { environment = await createTestEnvironment() })
afterAll(async () => environment.cleanup())

function db(uid: string | null): Firestore {
  const context = uid ? environment.authenticatedContext(uid) : environment.unauthenticatedContext()
  return context.firestore() as unknown as Firestore
}

function scan(uid: string | null, unitId: string) {
  return getDoc(doc(db(uid), 'inventory_units', unitId))
}

beforeEach(async () => {
  await environment.clearFirestore()

  await seedOrganization(environment, { organizationId: ORG_A, adminUid: ADMIN, code: CODE_A })
  await seedOrganization(environment, { organizationId: ORG_B, adminUid: OUTSIDER, code: CODE_B })

  await seedTeam(environment, { teamId: TEAM_LIGHTING, organizationId: ORG_A, name: 'Lighting' })
  await seedTeam(environment, { teamId: TEAM_OTHER_ORG, organizationId: ORG_B, name: 'Sound' })

  await seedMembership(environment, {
    organizationId: ORG_A, uid: OWNER_VIEWER, teamIds: [TEAM_LIGHTING],
    permissions: VIEW_INVENTORY,
  })
  await seedMembership(environment, {
    organizationId: ORG_A, uid: OWNER_EDITOR, teamIds: [TEAM_LIGHTING],
    permissions: EDIT_INVENTORY,
  })
  await seedMembership(environment, {
    organizationId: ORG_A, uid: NO_INVENTORY, teamIds: [TEAM_LIGHTING],
    permissions: { inventory: 'none', maintenance: 'edit', productions: 'none', calendar: 'none' },
  })
  await seedMembership(environment, {
    organizationId: ORG_A, uid: IN_BOTH, teamIds: [TEAM_LIGHTING], permissions: VIEW_INVENTORY,
  })
  await seedMembership(environment, {
    organizationId: ORG_B, uid: IN_BOTH, teamIds: [TEAM_OTHER_ORG], permissions: VIEW_INVENTORY,
  })
  await seedMembership(environment, {
    organizationId: ORG_B, uid: OUTSIDER, teamIds: [TEAM_OTHER_ORG], permissions: EDIT_INVENTORY,
  })
  await seedMembership(environment, {
    organizationId: ORG_A, uid: SPLIT_ACCESS, teamIds: [TEAM_LIGHTING],
    permissions: { inventory: 'none', maintenance: 'edit', productions: 'none', calendar: 'none' },
  })
  await seedMembership(environment, {
    organizationId: ORG_B, uid: SPLIT_ACCESS, teamIds: [TEAM_OTHER_ORG],
    permissions: VIEW_INVENTORY,
  })

  await environment.withSecurityRulesDisabled(async (context) => {
    const store = context.firestore() as unknown as Firestore

    for (const seed of [
      { itemId: ITEM_A, unitId: UNIT_A, org: ORG_A, team: TEAM_LIGHTING, uid: ADMIN },
      { itemId: ITEM_B, unitId: UNIT_B, org: ORG_B, team: TEAM_OTHER_ORG, uid: OUTSIDER },
    ]) {
      await setDoc(doc(store, 'inventory_items', seed.itemId), buildInventoryItemDocument({
        itemId: seed.itemId,
        organizationId: seed.org,
        uid: seed.uid,
        now: serverTimestamp,
        input: {
          name: 'Wireless Handheld',
          category: 'Microphones',
          teamId: seed.team,
          quantityTotal: 1,
          quantityAvailable: 1,
          conditionCounts: { ...EMPTY_CONDITION_COUNTS, good: 1 },
          location: 'Booth',
        },
      }))

      await setDoc(doc(store, 'inventory_units', seed.unitId), buildInventoryUnitDocument({
        unitId: seed.unitId,
        organizationId: seed.org,
        inventoryItemId: seed.itemId,
        uid: seed.uid,
        now: serverTimestamp,
        input: {
          owningTeamId: seed.team,
          assetCode: 'MIC-001',
          condition: 'good',
          status: 'available',
          storageLocation: 'Booth',
          retirementReason: null,
          usingTeamId: null,
          usingMemberUid: null,
        },
      }))
    }
  })
})

describe('who may open a scanned label', () => {
  it('opens for a member of the organization that owns the equipment', async () => {
    await assertSucceeds(scan(OWNER_VIEWER, UNIT_A))
  })

  it('stays shut for someone who is signed out', async () => {
    // The most likely scan of all: a phone camera, no session, a stranger.
    await assertFails(scan(null, UNIT_A))
  })

  it('stays shut for a signed-in stranger', async () => {
    await assertFails(scan(STRANGER, UNIT_A))
  })

  it('stays shut for a member of a different organization', async () => {
    // OUTSIDER runs ORG_B. Their own equipment scans; ORG_A's does not.
    await assertSucceeds(scan(OUTSIDER, UNIT_B))
    await assertFails(scan(OUTSIDER, UNIT_A))
  })

  it('stays shut for a member of the right organization without inventory access', async () => {
    // Being on the crew is not enough; the label is not a permission.
    await assertFails(scan(NO_INVENTORY, UNIT_A))
  })
})

describe('a label scanned by someone in more than one organization', () => {
  it('opens equipment from either organization, whichever is currently active', async () => {
    // The active organization lives in the browser, not in Firestore. Rules
    // decide from the unit's own `organization_id`, which is why the interface
    // may offer to switch organizations instead of claiming the unit is gone.
    await assertSucceeds(scan(IN_BOTH, UNIT_A))
    await assertSucceeds(scan(IN_BOTH, UNIT_B))
  })
})

describe('inventory access is per organization, and so is the answer', () => {
  it('opens equipment from the organization that grants access, not the one that is open', async () => {
    // SPLIT_ACCESS has no inventory permission in ORG_A and view in ORG_B.
    // Whichever organization their browser has open, Firestore answers from the
    // unit's own `organization_id` — which is the entire reason the equipment
    // route may sit outside the active organization's permission guard. The
    // guard decided rendering; this decides access, and it did not move.
    await assertSucceeds(scan(SPLIT_ACCESS, UNIT_B))
    await assertFails(scan(SPLIT_ACCESS, UNIT_A))
  })

  it('does not let the owning organization grant what it never granted', async () => {
    // The mirror image: access in the open organization is no help at all for
    // equipment belonging to one that gives none.
    await assertFails(scan(NO_INVENTORY, UNIT_B))
  })
})

describe('a label for equipment that is not there', () => {
  it('refuses a unit id that never existed, telling the scanner nothing', async () => {
    // Worth pinning down: rules read `resource.data.organization_id`, and a
    // missing document has no `resource`. The read is denied rather than
    // returning an empty snapshot — so "no such equipment" and "not your
    // equipment" are indistinguishable from outside, for everyone.
    await assertFails(scan(OWNER_EDITOR, NEVER_EXISTED))
    await assertFails(scan(STRANGER, NEVER_EXISTED))
    await assertFails(scan(null, NEVER_EXISTED))
  })
})

describe('what a label does not become', () => {
  it('does not let a scanner write anything', async () => {
    // Opening a link is reading. A viewer in the owning organization can see
    // the unit and still not change it.
    await assertFails(
      setDoc(doc(db(OWNER_VIEWER), 'inventory_units', UNIT_A), { asset_code: 'HACKED' }),
    )
  })

  it('does not let the id in a link be used to reach the parent item', async () => {
    // The unit page loads its item too. That read is gated the same way.
    await assertFails(getDoc(doc(db(STRANGER), 'inventory_items', ITEM_A)))
    await assertSucceeds(getDoc(doc(db(OWNER_VIEWER), 'inventory_items', ITEM_A)))
  })
})

describe('the equipment a label points at', () => {
  it('is still readable after it is retired', async () => {
    // A QR is printed once and outlives the equipment's working life. Nothing
    // about the read depends on status, so an archived unit still opens.
    await environment.withSecurityRulesDisabled(async (context) => {
      const store = context.firestore() as unknown as Firestore
      const snapshot = await getDoc(doc(store, 'inventory_units', UNIT_A))
      await setDoc(doc(store, 'inventory_units', UNIT_A), {
        ...snapshot.data(),
        status: 'retired',
        retirement_reason: 'disposed',
      })
    })

    const opened = await assertSucceeds(scan(OWNER_VIEWER, UNIT_A))
    expect(opened.exists()).toBe(true)
  })
})
