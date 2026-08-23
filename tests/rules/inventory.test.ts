import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type Firestore,
} from 'firebase/firestore'
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { buildInventoryItemDocument } from '@/domain/inventory-payloads'
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

let environment: RulesTestEnvironment

const VIEWER = 'uid-inventory-viewer'
const EDITOR = 'uid-inventory-editor'
const COSTUME_EDITOR = 'uid-costume-editor'
const NO_ACCESS = 'uid-inventory-none'
const DEACTIVATED = 'uid-inventory-deactivated'

const ITEM_LIGHTING = 'itemLIGHTINGAAAAAAAA'
const ITEM_COSTUME = 'itemCOSTUMEBBBBBBBBB'
const ITEM_OTHER_ORG = 'itemOTHERORGCCCCCCCC'

beforeAll(async () => {
  environment = await createTestEnvironment()
})
afterAll(async () => environment.cleanup())

function db(uid: string | null): Firestore {
  const context = uid ? environment.authenticatedContext(uid) : environment.unauthenticatedContext()
  return context.firestore() as unknown as Firestore
}

/** The same payload the inventory service builds. */
function itemPayload(
  overrides: Partial<{
    itemId: string
    organizationId: string
    uid: string
    teamId: string
    quantityTotal: number
    quantityAvailable: number
    conditionCounts: typeof EMPTY_CONDITION_COUNTS
  }> = {},
) {
  const itemId = overrides.itemId ?? ITEM_LIGHTING
  return buildInventoryItemDocument({
    itemId,
    organizationId: overrides.organizationId ?? ORG_A,
    uid: overrides.uid ?? ADMIN,
    now: serverTimestamp,
    input: {
      name: 'ETC Source Four 26',
      category: 'Lighting Instruments',
      teamId: overrides.teamId ?? TEAM_LIGHTING,
      quantityTotal: overrides.quantityTotal ?? 12,
      quantityAvailable: overrides.quantityAvailable ?? 8,
      conditionCounts: overrides.conditionCounts ?? {
        ...EMPTY_CONDITION_COUNTS,
        good: 9,
        fair: 2,
        needs_repair: 1,
      },
      location: 'Lighting Storage A',
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
  await seedMembership(environment, {
    organizationId: ORG_A,
    uid: NO_ACCESS,
    teamIds: [TEAM_LIGHTING],
  })
  await seedMembership(environment, {
    organizationId: ORG_A,
    uid: DEACTIVATED,
    teamIds: [TEAM_LIGHTING],
    permissions: EDIT_INVENTORY,
    isActive: false,
  })

  await environment.withSecurityRulesDisabled(async (context) => {
    const store = context.firestore() as unknown as Firestore
    await setDoc(doc(store, 'inventory_items', ITEM_LIGHTING), itemPayload())
    await setDoc(
      doc(store, 'inventory_items', ITEM_COSTUME),
      itemPayload({ itemId: ITEM_COSTUME, teamId: TEAM_COSTUME }),
    )
    await setDoc(
      doc(store, 'inventory_items', ITEM_OTHER_ORG),
      itemPayload({ itemId: ITEM_OTHER_ORG, organizationId: ORG_B, teamId: TEAM_OTHER_ORG, uid: OUTSIDER }),
    )
  })
})

describe('inventory read', () => {
  it('123. Admin reads an item in their organization', async () => {
    await assertSucceeds(getDoc(doc(db(ADMIN), 'inventory_items', ITEM_LIGHTING)))
  })

  it('124. Admin cannot read another organization item', async () => {
    await assertFails(getDoc(doc(db(ADMIN), 'inventory_items', ITEM_OTHER_ORG)))
  })

  it('125. view member reads an item on their own team', async () => {
    await assertSucceeds(getDoc(doc(db(VIEWER), 'inventory_items', ITEM_LIGHTING)))
  })

  it('126. view member reads an item on another team, because reading is organization-wide', async () => {
    await assertSucceeds(getDoc(doc(db(VIEWER), 'inventory_items', ITEM_COSTUME)))
  })

  it('127. edit member reads an item on another team', async () => {
    await assertSucceeds(getDoc(doc(db(EDITOR), 'inventory_items', ITEM_COSTUME)))
  })

  it('128. member with inventory none is denied', async () => {
    await assertFails(getDoc(doc(db(NO_ACCESS), 'inventory_items', ITEM_LIGHTING)))
  })

  it('129. deactivated membership is denied', async () => {
    await assertFails(getDoc(doc(db(DEACTIVATED), 'inventory_items', ITEM_LIGHTING)))
  })

  it('130. a user with no membership at all is denied', async () => {
    await assertFails(getDoc(doc(db(OUTSIDER), 'inventory_items', ITEM_LIGHTING)))
  })

  it('131. an unauthenticated caller is denied', async () => {
    await assertFails(getDoc(doc(db(null), 'inventory_items', ITEM_LIGHTING)))
  })
})

describe('inventory list query', () => {
  function listQuery(store: Firestore, organizationId: string) {
    return query(
      collection(store, 'inventory_items'),
      where('organization_id', '==', organizationId),
    )
  }

  it('132. the service list query succeeds for an Admin and returns every team', async () => {
    const snapshot = await assertSucceeds(getDocs(listQuery(db(ADMIN), ORG_A)))
    expect(snapshot.size).toBe(2)
  })

  it('133. the same query succeeds for a view member and returns every team', async () => {
    const snapshot = await assertSucceeds(getDocs(listQuery(db(VIEWER), ORG_A)))
    expect(snapshot.size).toBe(2)
  })

  it('134. the same query succeeds for an edit member', async () => {
    const snapshot = await assertSucceeds(getDocs(listQuery(db(EDITOR), ORG_A)))
    expect(snapshot.size).toBe(2)
  })

  it('135. a member cannot query another organization', async () => {
    await assertFails(getDocs(listQuery(db(VIEWER), ORG_B)))
  })

  it('136. an unfiltered query across all organizations is rejected', async () => {
    await assertFails(getDocs(collection(db(VIEWER), 'inventory_items')))
  })

  it('137. a member with inventory none is rejected', async () => {
    await assertFails(getDocs(listQuery(db(NO_ACCESS), ORG_A)))
  })
})

describe('inventory create', () => {
  const NEW_ITEM = 'itemNEWNEWNEWNEWNEW1'

  it('138. Admin creates an item on any team', async () => {
    await assertSucceeds(
      setDoc(
        doc(db(ADMIN), 'inventory_items', NEW_ITEM),
        itemPayload({ itemId: NEW_ITEM, teamId: TEAM_COSTUME, uid: ADMIN }),
      ),
    )
  })

  it('139. edit member creates an item on their own team', async () => {
    await assertSucceeds(
      setDoc(
        doc(db(EDITOR), 'inventory_items', NEW_ITEM),
        itemPayload({ itemId: NEW_ITEM, teamId: TEAM_LIGHTING, uid: EDITOR }),
      ),
    )
  })

  it('140. edit member cannot create on another team', async () => {
    await assertFails(
      setDoc(
        doc(db(EDITOR), 'inventory_items', NEW_ITEM),
        itemPayload({ itemId: NEW_ITEM, teamId: TEAM_COSTUME, uid: EDITOR }),
      ),
    )
  })

  it('141. view member cannot create at all', async () => {
    await assertFails(
      setDoc(
        doc(db(VIEWER), 'inventory_items', NEW_ITEM),
        itemPayload({ itemId: NEW_ITEM, teamId: TEAM_LIGHTING, uid: VIEWER }),
      ),
    )
  })

  it('142. cannot create against another organization', async () => {
    await assertFails(
      setDoc(
        doc(db(EDITOR), 'inventory_items', NEW_ITEM),
        itemPayload({ itemId: NEW_ITEM, organizationId: ORG_B, teamId: TEAM_OTHER_ORG, uid: EDITOR }),
      ),
    )
  })

  it('143. cannot name a team from another organization', async () => {
    await assertFails(
      setDoc(
        doc(db(ADMIN), 'inventory_items', NEW_ITEM),
        itemPayload({ itemId: NEW_ITEM, teamId: TEAM_OTHER_ORG, uid: ADMIN }),
      ),
    )
  })

  it('144. cannot name a team that does not exist', async () => {
    await assertFails(
      setDoc(
        doc(db(ADMIN), 'inventory_items', NEW_ITEM),
        itemPayload({ itemId: NEW_ITEM, teamId: 'teamDOESNOTEXIST0000', uid: ADMIN }),
      ),
    )
  })

  it('145. rejects an unknown field', async () => {
    await assertFails(
      setDoc(doc(db(ADMIN), 'inventory_items', NEW_ITEM), {
        ...itemPayload({ itemId: NEW_ITEM, uid: ADMIN }),
        photo_url: 'https://example.com/x.png',
      }),
    )
  })

  it('146. rejects a document ID that disagrees with item_id', async () => {
    await assertFails(
      setDoc(
        doc(db(ADMIN), 'inventory_items', 'itemMISMATCHMISMATCH'),
        itemPayload({ itemId: NEW_ITEM, uid: ADMIN }),
      ),
    )
  })

  it('147. rejects a negative quantity', async () => {
    await assertFails(
      setDoc(
        doc(db(ADMIN), 'inventory_items', NEW_ITEM),
        itemPayload({ itemId: NEW_ITEM, uid: ADMIN, quantityTotal: -1, quantityAvailable: 0 }),
      ),
    )
  })

  it('148. rejects available exceeding total', async () => {
    await assertFails(
      setDoc(
        doc(db(ADMIN), 'inventory_items', NEW_ITEM),
        itemPayload({ itemId: NEW_ITEM, uid: ADMIN, quantityTotal: 5, quantityAvailable: 6 }),
      ),
    )
  })

  it('149. rejects a fractional quantity', async () => {
    await assertFails(
      setDoc(doc(db(ADMIN), 'inventory_items', NEW_ITEM), {
        ...itemPayload({ itemId: NEW_ITEM, uid: ADMIN }),
        quantity_total: 12.5,
      }),
    )
  })

  it('150. rejects condition counts adding up beyond the total', async () => {
    await assertFails(
      setDoc(
        doc(db(ADMIN), 'inventory_items', NEW_ITEM),
        itemPayload({
          itemId: NEW_ITEM,
          uid: ADMIN,
          quantityTotal: 5,
          quantityAvailable: 5,
          conditionCounts: { ...EMPTY_CONDITION_COUNTS, good: 4, fair: 4 },
        }),
      ),
    )
  })

  it('151. rejects a negative condition count', async () => {
    await assertFails(
      setDoc(
        doc(db(ADMIN), 'inventory_items', NEW_ITEM),
        itemPayload({
          itemId: NEW_ITEM,
          uid: ADMIN,
          conditionCounts: { ...EMPTY_CONDITION_COUNTS, good: -1 },
        }),
      ),
    )
  })

  it('152. rejects a missing condition bucket', async () => {
    const payload = itemPayload({ itemId: NEW_ITEM, uid: ADMIN })
    await assertFails(
      setDoc(doc(db(ADMIN), 'inventory_items', NEW_ITEM), {
        ...payload,
        condition_counts: { excellent: 1, good: 1, fair: 1, needs_repair: 1 },
      }),
    )
  })

  it('153. rejects an empty name', async () => {
    await assertFails(
      setDoc(doc(db(ADMIN), 'inventory_items', NEW_ITEM), {
        ...itemPayload({ itemId: NEW_ITEM, uid: ADMIN }),
        name: '',
      }),
    )
  })

  it('154. rejects created_by_uid naming somebody else', async () => {
    await assertFails(
      setDoc(
        doc(db(EDITOR), 'inventory_items', NEW_ITEM),
        itemPayload({ itemId: NEW_ITEM, teamId: TEAM_LIGHTING, uid: ADMIN }),
      ),
    )
  })
})

describe('inventory category allowlist', () => {
  const NEW_ITEM = 'itemCATEGORYAAAAAAA1'

  function withCategory(category: string, itemId = NEW_ITEM) {
    return { ...itemPayload({ itemId, uid: ADMIN }), category }
  }

  it('171. accepts a create using an allowed category', async () => {
    await assertSucceeds(
      setDoc(doc(db(ADMIN), 'inventory_items', NEW_ITEM), withCategory('Sound Equipment')),
    )
  })

  it('172. accepts every category in the MVP set', async () => {
    const categories = [
      'Lighting Instruments',
      'Cables',
      'Lighting Accessories',
      'Sound Equipment',
      'Microphones',
      'Tools',
      'Set-Building Materials',
      'Platforms / Flats',
      'Props',
      'Costumes',
      'Hardware',
      'Miscellaneous Technical Equipment',
    ]

    for (const [index, category] of categories.entries()) {
      const itemId = `itemCATEGORYSET${String(index).padStart(5, '0')}`
      await assertSucceeds(
        setDoc(doc(db(ADMIN), 'inventory_items', itemId), withCategory(category, itemId)),
      )
    }
  })

  it('173. rejects a create using an unsupported category', async () => {
    for (const category of ['Lighting', 'lighting instruments', 'Fog Machines', '']) {
      await assertFails(
        setDoc(doc(db(ADMIN), 'inventory_items', NEW_ITEM), withCategory(category)),
      )
    }
  })

  // created_at is immutable, so these change the category in place rather than
  // rewriting the document with a freshly built create payload.
  it('174. accepts an update moving to another allowed category', async () => {
    await assertSucceeds(
      updateDoc(doc(db(ADMIN), 'inventory_items', ITEM_LIGHTING), {
        category: 'Lighting Accessories',
        updated_at: serverTimestamp(),
      }),
    )
  })

  it('175. rejects an update to an unsupported category', async () => {
    await assertFails(
      updateDoc(doc(db(ADMIN), 'inventory_items', ITEM_LIGHTING), {
        category: 'Fog Machines',
        updated_at: serverTimestamp(),
      }),
    )
  })

  it('176. rejects an update by an edit member to an unsupported category', async () => {
    await assertFails(
      updateDoc(doc(db(EDITOR), 'inventory_items', ITEM_LIGHTING), {
        category: 'Whatever',
        updated_at: serverTimestamp(),
      }),
    )
  })

  it('177. rejects an update that only changes created_at, proving immutability holds', async () => {
    await assertFails(
      updateDoc(doc(db(ADMIN), 'inventory_items', ITEM_LIGHTING), {
        created_at: serverTimestamp(),
        updated_at: serverTimestamp(),
      }),
    )
  })
})
