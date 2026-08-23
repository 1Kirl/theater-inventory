import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest'
import { doc, serverTimestamp, setDoc, updateDoc, writeBatch, type Firestore } from 'firebase/firestore'
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { buildInventoryItemUpdate } from '@/domain/inventory-payloads'
import { EMPTY_CONDITION_COUNTS } from '@/domain/inventory'
import {
  ADMIN,
  CODE_A,
  CODE_B,
  EDIT_INVENTORY,
  ORG_A,
  ORG_B,
  OUTSIDER,
  TEAM_COSTUME,
  TEAM_LIGHTING,
  TEAM_OTHER_ORG,
  VIEW_INVENTORY,
  assertFails,
  assertSucceeds,
  createTestEnvironment,
  seedMembership,
  seedOrganization,
  seedTeam,
} from './helpers'
import type { InventoryItem } from '@/types/inventory'

let environment: RulesTestEnvironment

const VIEWER = 'uid-inventory-viewer'
const EDITOR = 'uid-inventory-editor'
const COSTUME_EDITOR = 'uid-costume-editor'
const ITEM = 'itemLIGHTINGAAAAAAAA'

beforeAll(async () => {
  environment = await createTestEnvironment()
})
afterAll(async () => environment.cleanup())

function db(uid: string): Firestore {
  return environment.authenticatedContext(uid).firestore() as unknown as Firestore
}

let existing: InventoryItem

/** The same payload the inventory service builds for an update. */
function updatePayload(
  overrides: Partial<{
    teamId: string
    quantityTotal: number
    quantityAvailable: number
    conditionCounts: typeof EMPTY_CONDITION_COUNTS
    organizationId: string
    createdByUid: string
  }> = {},
) {
  return buildInventoryItemUpdate({
    itemId: ITEM,
    organizationId: overrides.organizationId ?? existing.organization_id,
    createdByUid: overrides.createdByUid ?? existing.created_by_uid,
    createdAt: existing.created_at,
    now: serverTimestamp,
    input: {
      name: 'ETC Source Four 26 (renamed)',
      category: 'Lighting Instruments',
      teamId: overrides.teamId ?? TEAM_LIGHTING,
      quantityTotal: overrides.quantityTotal ?? 12,
      quantityAvailable: overrides.quantityAvailable ?? 6,
      conditionCounts: overrides.conditionCounts ?? { ...EMPTY_CONDITION_COUNTS, good: 10 },
      location: 'Lighting Storage B',
    },
  })
}

beforeEach(async () => {
  await environment.clearFirestore()

  await seedOrganization(environment, { organizationId: ORG_A, adminUid: ADMIN, code: CODE_A })
  await seedOrganization(environment, { organizationId: ORG_B, adminUid: OUTSIDER, code: CODE_B })
  await seedTeam(environment, { teamId: TEAM_LIGHTING, organizationId: ORG_A, name: 'Lighting' })
  await seedTeam(environment, { teamId: TEAM_COSTUME, organizationId: ORG_A, name: 'Costume' })
  await seedTeam(environment, { teamId: TEAM_OTHER_ORG, organizationId: ORG_B, name: 'Sound' })

  await seedMembership(environment, {
    organizationId: ORG_A,
    uid: VIEWER,
    teamIds: [TEAM_LIGHTING],
    permissions: VIEW_INVENTORY,
  })
  await seedMembership(environment, {
    organizationId: ORG_A,
    uid: EDITOR,
    teamIds: [TEAM_LIGHTING],
    permissions: EDIT_INVENTORY,
  })
  await seedMembership(environment, {
    organizationId: ORG_A,
    uid: COSTUME_EDITOR,
    teamIds: [TEAM_COSTUME],
    permissions: EDIT_INVENTORY,
  })

  await environment.withSecurityRulesDisabled(async (context) => {
    const store = context.firestore() as unknown as Firestore
    await setDoc(doc(store, 'inventory_items', ITEM), {
      item_id: ITEM,
      organization_id: ORG_A,
      name: 'ETC Source Four 26',
      category: 'Lighting Instruments',
      team_id: TEAM_LIGHTING,
      quantity_total: 12,
      quantity_available: 8,
      condition_counts: { ...EMPTY_CONDITION_COUNTS, good: 9, fair: 2, needs_repair: 1 },
      location: 'Lighting Storage A',
      created_by_uid: ADMIN,
      created_at: serverTimestamp(),
      updated_at: serverTimestamp(),
    })

    const snapshot = await import('firebase/firestore').then(({ getDoc }) =>
      getDoc(doc(store, 'inventory_items', ITEM)),
    )
    existing = snapshot.data() as InventoryItem
  })
})

describe('inventory update', () => {
  it('155. Admin updates an item on any team', async () => {
    await assertSucceeds(setDoc(doc(db(ADMIN), 'inventory_items', ITEM), updatePayload()))
  })

  it('156. edit member updates an item on their own team', async () => {
    await assertSucceeds(setDoc(doc(db(EDITOR), 'inventory_items', ITEM), updatePayload()))
  })

  it('157. view member cannot update, even on their own team', async () => {
    await assertFails(setDoc(doc(db(VIEWER), 'inventory_items', ITEM), updatePayload()))
  })

  it('158. edit member on another team cannot update this item', async () => {
    await assertFails(setDoc(doc(db(COSTUME_EDITOR), 'inventory_items', ITEM), updatePayload()))
  })

  it('159. an Admin of another organization cannot update it', async () => {
    await assertFails(setDoc(doc(db(OUTSIDER), 'inventory_items', ITEM), updatePayload()))
  })

  it('160. Admin may move an item to another team in the organization', async () => {
    await assertSucceeds(
      setDoc(doc(db(ADMIN), 'inventory_items', ITEM), updatePayload({ teamId: TEAM_COSTUME })),
    )
  })

  it('161. edit member cannot move an item outside their teams', async () => {
    await assertFails(
      setDoc(doc(db(EDITOR), 'inventory_items', ITEM), updatePayload({ teamId: TEAM_COSTUME })),
    )
  })

  it('162. nobody may move an item to a team in another organization', async () => {
    await assertFails(
      setDoc(doc(db(ADMIN), 'inventory_items', ITEM), updatePayload({ teamId: TEAM_OTHER_ORG })),
    )
  })

  it('163. organization_id cannot be changed', async () => {
    await assertFails(
      updateDoc(doc(db(ADMIN), 'inventory_items', ITEM), {
        organization_id: ORG_B,
        updated_at: serverTimestamp(),
      }),
    )
  })

  it('164. created_by_uid cannot be changed', async () => {
    await assertFails(
      setDoc(doc(db(EDITOR), 'inventory_items', ITEM), updatePayload({ createdByUid: EDITOR })),
    )
  })

  it('165. item_id cannot be changed', async () => {
    await assertFails(
      updateDoc(doc(db(ADMIN), 'inventory_items', ITEM), {
        item_id: 'itemSOMETHINGELSE001',
        updated_at: serverTimestamp(),
      }),
    )
  })

  it('166. created_at cannot be changed', async () => {
    await assertFails(
      updateDoc(doc(db(ADMIN), 'inventory_items', ITEM), {
        created_at: serverTimestamp(),
        updated_at: serverTimestamp(),
      }),
    )
  })

  it('167. an update breaking the quantity invariant is rejected', async () => {
    await assertFails(
      setDoc(
        doc(db(ADMIN), 'inventory_items', ITEM),
        updatePayload({ quantityTotal: 4, quantityAvailable: 9 }),
      ),
    )
  })

  it('168. an update whose condition counts exceed the total is rejected', async () => {
    await assertFails(
      setDoc(
        doc(db(ADMIN), 'inventory_items', ITEM),
        updatePayload({
          quantityTotal: 5,
          quantityAvailable: 5,
          conditionCounts: { ...EMPTY_CONDITION_COUNTS, good: 6 },
        }),
      ),
    )
  })

  it('169. an update adding an unknown field is rejected', async () => {
    await assertFails(
      setDoc(doc(db(ADMIN), 'inventory_items', ITEM), {
        ...updatePayload(),
        photo_url: 'https://example.com/x.png',
      }),
    )
  })

  it('170. deleting an inventory item is denied for everyone', async () => {
    for (const uid of [ADMIN, EDITOR, VIEWER]) {
      const store = db(uid)
      const batch = writeBatch(store)
      batch.delete(doc(store, 'inventory_items', ITEM))
      await assertFails(batch.commit())
    }
  })
})
