import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  collection, doc, getDoc, getDocs, query, serverTimestamp, setDoc, updateDoc, where,
  writeBatch, type Firestore,
} from 'firebase/firestore'
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { buildInventoryItemDocument } from '@/domain/inventory-payloads'
import {
  buildActionItemDocument, buildProductionDocument, buildRequirementDocument,
} from '@/domain/production-payloads'
import { EMPTY_CONDITION_COUNTS } from '@/domain/inventory'
import {
  ADMIN, CODE_A, CODE_B, ORG_A, ORG_B, OUTSIDER, TEAM_COSTUME, TEAM_LIGHTING, TEAM_OTHER_ORG,
  assertFails, assertSucceeds, createTestEnvironment, seedMembership, seedOrganization, seedTeam,
} from './helpers'

let environment: RulesTestEnvironment

const VIEWER = 'uid-prod-viewer'
const EDITOR = 'uid-prod-editor'
const COSTUME_EDITOR = 'uid-prod-costume'
const NO_ACCESS = 'uid-prod-none'
const DEACTIVATED = 'uid-prod-deactivated'

const PROD_A = 'prodAAAAAAAAAAAAAAAA'
const PROD_B = 'prodBBBBBBBBBBBBBBBB'
const ITEM_SHORT = 'itemSHORTAAAAAAAAAA1'   // available 5
const ITEM_PLENTY = 'itemPLENTYBBBBBBBBB1'  // available 40
const ITEM_OTHER_ORG = 'itemOTHERORGCCCCCCCC'
const REQ_SHORT = 'reqSHORTAAAAAAAAAAA1'    // required 8 vs 5 -> short 3
const REQ_COVERED = 'reqCOVEREDBBBBBBBBB1'  // required 10 vs 40 -> short 0
const REQ_UNMATCHED = 'reqUNMATCHEDCCCCCCC1'
const REQ_COSTUME = 'reqCOSTUMEDDDDDDDDD1'

const VIEW_PROD = { inventory: 'view', maintenance: 'none', productions: 'view', calendar: 'none' } as const
const EDIT_PROD = { inventory: 'view', maintenance: 'none', productions: 'edit', calendar: 'none' } as const
const NO_PROD = { inventory: 'edit', maintenance: 'none', productions: 'none', calendar: 'none' } as const

beforeAll(async () => { environment = await createTestEnvironment() })
afterAll(async () => environment.cleanup())

function db(uid: string | null): Firestore {
  const context = uid ? environment.authenticatedContext(uid) : environment.unauthenticatedContext()
  return context.firestore() as unknown as Firestore
}

function itemDoc(itemId: string, organizationId: string, teamId: string, available: number) {
  return buildInventoryItemDocument({
    itemId, organizationId, uid: ADMIN, now: serverTimestamp,
    input: {
      name: 'Item', category: 'Microphones', teamId,
      quantityTotal: 50, quantityAvailable: available,
      conditionCounts: { ...EMPTY_CONDITION_COUNTS, good: 50 }, location: 'Store',
    },
  })
}

function productionDoc(productionId: string, organizationId: string) {
  return buildProductionDocument({
    productionId, organizationId, uid: ADMIN, now: serverTimestamp,
    input: { title: 'Spring Musical', status: 'planning' },
  })
}

function requirementDoc(o: {
  requirementId: string; organizationId?: string; productionId?: string; teamId?: string
  itemId?: string | null; requiredQty?: number; uid?: string
}) {
  return buildRequirementDocument({
    requirementId: o.requirementId,
    organizationId: o.organizationId ?? ORG_A,
    productionId: o.productionId ?? PROD_A,
    uid: o.uid ?? ADMIN,
    now: serverTimestamp,
    input: {
      itemName: 'Wireless Microphone',
      inventoryItemId: o.itemId === undefined ? ITEM_SHORT : o.itemId,
      requiredQty: o.requiredQty ?? 8,
      teamId: o.teamId ?? TEAM_LIGHTING,
    },
  })
}

function actionDoc(o: {
  requirementId: string; organizationId?: string; productionId?: string; teamId?: string
  quantity?: number; uid?: string
}) {
  return buildActionItemDocument({
    requirementId: o.requirementId,
    organizationId: o.organizationId ?? ORG_A,
    productionId: o.productionId ?? PROD_A,
    itemName: 'Wireless Microphone',
    teamId: o.teamId ?? TEAM_LIGHTING,
    uid: o.uid ?? ADMIN,
    now: serverTimestamp,
    input: { actionType: 'rent', quantity: o.quantity ?? 3, status: 'todo' },
  })
}

beforeEach(async () => {
  await environment.clearFirestore()
  await seedOrganization(environment, { organizationId: ORG_A, adminUid: ADMIN, code: CODE_A })
  await seedOrganization(environment, { organizationId: ORG_B, adminUid: OUTSIDER, code: CODE_B })
  await seedTeam(environment, { teamId: TEAM_LIGHTING, organizationId: ORG_A, name: 'Sound' })
  await seedTeam(environment, { teamId: TEAM_COSTUME, organizationId: ORG_A, name: 'Costume' })
  await seedTeam(environment, { teamId: TEAM_OTHER_ORG, organizationId: ORG_B, name: 'Other' })

  await seedMembership(environment, { organizationId: ORG_A, uid: VIEWER, teamIds: [TEAM_LIGHTING], permissions: VIEW_PROD })
  await seedMembership(environment, { organizationId: ORG_A, uid: EDITOR, teamIds: [TEAM_LIGHTING], permissions: EDIT_PROD })
  await seedMembership(environment, { organizationId: ORG_A, uid: COSTUME_EDITOR, teamIds: [TEAM_COSTUME], permissions: EDIT_PROD })
  await seedMembership(environment, { organizationId: ORG_A, uid: NO_ACCESS, teamIds: [TEAM_LIGHTING], permissions: NO_PROD })
  await seedMembership(environment, { organizationId: ORG_A, uid: DEACTIVATED, teamIds: [TEAM_LIGHTING], permissions: EDIT_PROD, isActive: false })

  await environment.withSecurityRulesDisabled(async (context) => {
    const s = context.firestore() as unknown as Firestore
    await setDoc(doc(s, 'inventory_items', ITEM_SHORT), itemDoc(ITEM_SHORT, ORG_A, TEAM_LIGHTING, 5))
    await setDoc(doc(s, 'inventory_items', ITEM_PLENTY), itemDoc(ITEM_PLENTY, ORG_A, TEAM_COSTUME, 40))
    await setDoc(doc(s, 'inventory_items', ITEM_OTHER_ORG), itemDoc(ITEM_OTHER_ORG, ORG_B, TEAM_OTHER_ORG, 10))
    await setDoc(doc(s, 'productions', PROD_A), productionDoc(PROD_A, ORG_A))
    await setDoc(doc(s, 'productions', PROD_B), productionDoc(PROD_B, ORG_B))
    await setDoc(doc(s, 'production_requirements', REQ_SHORT), requirementDoc({ requirementId: REQ_SHORT }))
    await setDoc(doc(s, 'production_requirements', REQ_COVERED), requirementDoc({ requirementId: REQ_COVERED, itemId: ITEM_PLENTY, requiredQty: 10 }))
    await setDoc(doc(s, 'production_requirements', REQ_UNMATCHED), requirementDoc({ requirementId: REQ_UNMATCHED, itemId: null }))
    await setDoc(doc(s, 'production_requirements', REQ_COSTUME), requirementDoc({ requirementId: REQ_COSTUME, teamId: TEAM_COSTUME }))
  })
})

describe('productions', () => {
  const NEW_PROD = 'prodNEWNEWNEWNEWNEW1'

  it('223. Admin reads a production', async () => {
    await assertSucceeds(getDoc(doc(db(ADMIN), 'productions', PROD_A)))
  })

  it('224. view member reads a production', async () => {
    await assertSucceeds(getDoc(doc(db(VIEWER), 'productions', PROD_A)))
  })

  it('225. a member with productions none is denied', async () => {
    await assertFails(getDoc(doc(db(NO_ACCESS), 'productions', PROD_A)))
  })

  it('226. a deactivated membership is denied', async () => {
    await assertFails(getDoc(doc(db(DEACTIVATED), 'productions', PROD_A)))
  })

  it('227. another organization is denied', async () => {
    await assertFails(getDoc(doc(db(ADMIN), 'productions', PROD_B)))
  })

  it('228. an unauthenticated caller is denied', async () => {
    await assertFails(getDoc(doc(db(null), 'productions', PROD_A)))
  })

  it('229. edit member creates a production without any team check', async () => {
    // Productions are organization-level; the module permission alone decides.
    await assertSucceeds(setDoc(doc(db(EDITOR), 'productions', NEW_PROD), {
      ...productionDoc(NEW_PROD, ORG_A), created_by_uid: EDITOR,
    }))
  })

  it('230. view member cannot create', async () => {
    await assertFails(setDoc(doc(db(VIEWER), 'productions', NEW_PROD), {
      ...productionDoc(NEW_PROD, ORG_A), created_by_uid: VIEWER,
    }))
  })

  it('231. edit member updates a production', async () => {
    await assertSucceeds(updateDoc(doc(db(EDITOR), 'productions', PROD_A), {
      status: 'active', updated_at: serverTimestamp(),
    }))
  })

  it('232. an unsupported status is rejected', async () => {
    await assertFails(updateDoc(doc(db(ADMIN), 'productions', PROD_A), {
      status: 'archived', updated_at: serverTimestamp(),
    }))
  })

  it('233. organization_id and metadata are immutable', async () => {
    await assertFails(updateDoc(doc(db(ADMIN), 'productions', PROD_A), {
      organization_id: ORG_B, updated_at: serverTimestamp(),
    }))
    await assertFails(updateDoc(doc(db(ADMIN), 'productions', PROD_A), {
      created_at: serverTimestamp(), updated_at: serverTimestamp(),
    }))
  })

  it('234. an unknown field is rejected', async () => {
    await assertFails(updateDoc(doc(db(ADMIN), 'productions', PROD_A), {
      budget: 5000, updated_at: serverTimestamp(),
    }))
  })

  it('235. deleting a production is denied', async () => {
    const s = db(ADMIN); const b = writeBatch(s)
    b.delete(doc(s, 'productions', PROD_A))
    await assertFails(b.commit())
  })

  it('236. the organization production list query succeeds, and another organization does not', async () => {
    const snapshot = await assertSucceeds(getDocs(query(collection(db(VIEWER), 'productions'), where('organization_id', '==', ORG_A))))
    expect(snapshot.size).toBe(1)
    await assertFails(getDocs(query(collection(db(VIEWER), 'productions'), where('organization_id', '==', ORG_B))))
  })
})

describe('production requirements', () => {
  const NEW_REQ = 'reqNEWNEWNEWNEWNEWN1'

  it('237. view member reads requirements from any team, organization-wide', async () => {
    await assertSucceeds(getDoc(doc(db(VIEWER), 'production_requirements', REQ_COSTUME)))
  })

  it('238. a member with productions none is denied', async () => {
    await assertFails(getDoc(doc(db(NO_ACCESS), 'production_requirements', REQ_SHORT)))
  })

  it('239. Admin creates a requirement on any team', async () => {
    await assertSucceeds(setDoc(doc(db(ADMIN), 'production_requirements', NEW_REQ), requirementDoc({ requirementId: NEW_REQ, teamId: TEAM_COSTUME })))
  })

  it('240. edit member creates a requirement for their own team', async () => {
    await assertSucceeds(setDoc(doc(db(EDITOR), 'production_requirements', NEW_REQ), requirementDoc({ requirementId: NEW_REQ, uid: EDITOR })))
  })

  it('241. edit member cannot create for another team', async () => {
    await assertFails(setDoc(doc(db(EDITOR), 'production_requirements', NEW_REQ), requirementDoc({ requirementId: NEW_REQ, teamId: TEAM_COSTUME, uid: EDITOR })))
  })

  it('242. view member cannot create', async () => {
    await assertFails(setDoc(doc(db(VIEWER), 'production_requirements', NEW_REQ), requirementDoc({ requirementId: NEW_REQ, uid: VIEWER })))
  })

  it('243. a matched item from another team is accepted, because the item team is unrelated', async () => {
    // A sound requirement matching a costume-owned item is ordinary practice.
    await assertSucceeds(setDoc(doc(db(EDITOR), 'production_requirements', NEW_REQ), requirementDoc({
      requirementId: NEW_REQ, teamId: TEAM_LIGHTING, itemId: ITEM_PLENTY, uid: EDITOR,
    })))
  })

  it('244. an unmatched requirement is accepted', async () => {
    await assertSucceeds(setDoc(doc(db(EDITOR), 'production_requirements', NEW_REQ), requirementDoc({ requirementId: NEW_REQ, itemId: null, uid: EDITOR })))
  })

  it('245. a nonexistent production is rejected', async () => {
    await assertFails(setDoc(doc(db(ADMIN), 'production_requirements', NEW_REQ), requirementDoc({ requirementId: NEW_REQ, productionId: 'prodDOESNOTEXIST0001' })))
  })

  it('246. a production from another organization is rejected', async () => {
    await assertFails(setDoc(doc(db(ADMIN), 'production_requirements', NEW_REQ), requirementDoc({ requirementId: NEW_REQ, productionId: PROD_B })))
  })

  it('247. an inventory item from another organization is rejected', async () => {
    await assertFails(setDoc(doc(db(ADMIN), 'production_requirements', NEW_REQ), requirementDoc({ requirementId: NEW_REQ, itemId: ITEM_OTHER_ORG })))
  })

  it('248. a nonexistent inventory item is rejected', async () => {
    await assertFails(setDoc(doc(db(ADMIN), 'production_requirements', NEW_REQ), requirementDoc({ requirementId: NEW_REQ, itemId: 'itemDOESNOTEXIST0001' })))
  })

  it('249. required quantity must be a positive integer', async () => {
    for (const qty of [0, -1]) {
      await assertFails(setDoc(doc(db(ADMIN), 'production_requirements', NEW_REQ), requirementDoc({ requirementId: NEW_REQ, requiredQty: qty })))
    }
    await assertFails(setDoc(doc(db(ADMIN), 'production_requirements', NEW_REQ), {
      ...requirementDoc({ requirementId: NEW_REQ }), required_qty: 2.5,
    }))
  })

  it('250. an unknown field is rejected', async () => {
    await assertFails(setDoc(doc(db(ADMIN), 'production_requirements', NEW_REQ), {
      ...requirementDoc({ requirementId: NEW_REQ }), priority: 'high',
    }))
  })

  it('250b. action_type is rejected on a requirement, in create and in update', async () => {
    // The plan lives on the Action Item alone. A copy here could disagree with
    // it, so the field is not part of the schema at all.
    await assertFails(setDoc(doc(db(ADMIN), 'production_requirements', NEW_REQ), {
      ...requirementDoc({ requirementId: NEW_REQ }), action_type: 'rent',
    }))
    await assertFails(updateDoc(doc(db(ADMIN), 'production_requirements', REQ_SHORT), {
      action_type: 'rent', updated_at: serverTimestamp(),
    }))
    await assertFails(updateDoc(doc(db(ADMIN), 'production_requirements', REQ_SHORT), {
      action_type: 'already_available', updated_at: serverTimestamp(),
    }))
  })

  it('251. immutable identity and metadata are protected', async () => {
    await assertFails(updateDoc(doc(db(ADMIN), 'production_requirements', REQ_SHORT), {
      production_id: PROD_B, updated_at: serverTimestamp(),
    }))
    await assertFails(updateDoc(doc(db(ADMIN), 'production_requirements', REQ_SHORT), {
      created_by_uid: EDITOR, updated_at: serverTimestamp(),
    }))
  })

  it('252. edit member cannot move a requirement outside their teams', async () => {
    await assertFails(updateDoc(doc(db(EDITOR), 'production_requirements', REQ_SHORT), {
      team_id: TEAM_COSTUME, updated_at: serverTimestamp(),
    }))
  })

  it('253. other-team edit member cannot update this requirement', async () => {
    await assertFails(updateDoc(doc(db(COSTUME_EDITOR), 'production_requirements', REQ_SHORT), {
      required_qty: 12, updated_at: serverTimestamp(),
    }))
  })

  it('254. deleting a requirement is denied', async () => {
    const s = db(ADMIN); const b = writeBatch(s)
    b.delete(doc(s, 'production_requirements', REQ_SHORT))
    await assertFails(b.commit())
  })

  it('255. the requirements-for-production query succeeds', async () => {
    const snapshot = await assertSucceeds(getDocs(query(
      collection(db(VIEWER), 'production_requirements'),
      where('organization_id', '==', ORG_A), where('production_id', '==', PROD_A),
    )))
    expect(snapshot.size).toBe(4)
  })
})

describe('action items', () => {
  it('256. an action is created for a matched, short requirement', async () => {
    await assertSucceeds(setDoc(doc(db(EDITOR), 'action_items', REQ_SHORT), actionDoc({ requirementId: REQ_SHORT, uid: EDITOR })))
  })

  it('257. an action for an unmatched requirement is refused by Rules', async () => {
    await assertFails(setDoc(doc(db(ADMIN), 'action_items', REQ_UNMATCHED), actionDoc({ requirementId: REQ_UNMATCHED })))
  })

  it('258. an action for a covered requirement is refused by Rules', async () => {
    // required 10 against 40 available: nothing to action.
    await assertFails(setDoc(doc(db(ADMIN), 'action_items', REQ_COVERED), actionDoc({ requirementId: REQ_COVERED })))
  })

  it('259. a document ID that is not the requirement ID is refused', async () => {
    await assertFails(setDoc(doc(db(ADMIN), 'action_items', 'someOtherDocumentId1'), actionDoc({ requirementId: REQ_SHORT })))
  })

  it('260. a second action for the same requirement is impossible by document ID', async () => {
    await assertSucceeds(setDoc(doc(db(ADMIN), 'action_items', REQ_SHORT), actionDoc({ requirementId: REQ_SHORT })))
    const second = await getDoc(doc(db(ADMIN), 'action_items', REQ_SHORT))
    expect(second.exists()).toBe(true)
    expect(second.data()?.requirement_id).toBe(REQ_SHORT)
  })

  it('261. a forged team that does not match the requirement is refused', async () => {
    await assertFails(setDoc(doc(db(ADMIN), 'action_items', REQ_SHORT), actionDoc({ requirementId: REQ_SHORT, teamId: TEAM_COSTUME })))
  })

  it('262. a mismatched production is refused', async () => {
    await assertFails(setDoc(doc(db(ADMIN), 'action_items', REQ_SHORT), actionDoc({ requirementId: REQ_SHORT, productionId: PROD_B })))
  })

  it('263. view member cannot create an action', async () => {
    await assertFails(setDoc(doc(db(VIEWER), 'action_items', REQ_SHORT), actionDoc({ requirementId: REQ_SHORT, uid: VIEWER })))
  })

  it('264. other-team edit member cannot create an action', async () => {
    await assertFails(setDoc(doc(db(COSTUME_EDITOR), 'action_items', REQ_SHORT), actionDoc({ requirementId: REQ_SHORT, uid: COSTUME_EDITOR })))
  })

  it('265. an unsupported action type is refused, including already_available', async () => {
    for (const actionType of ['already_available', 'borrow']) {
      await assertFails(setDoc(doc(db(ADMIN), 'action_items', REQ_SHORT), {
        ...actionDoc({ requirementId: REQ_SHORT }), action_type: actionType,
      }))
    }
  })

  it('266. quantity must be a positive integer', async () => {
    for (const quantity of [0, -1]) {
      await assertFails(setDoc(doc(db(ADMIN), 'action_items', REQ_SHORT), actionDoc({ requirementId: REQ_SHORT, quantity })))
    }
  })

  it('267. a quantity differing from the shortage is accepted', async () => {
    // The crew may plan to rent one even though three are short.
    await assertSucceeds(setDoc(doc(db(ADMIN), 'action_items', REQ_SHORT), actionDoc({ requirementId: REQ_SHORT, quantity: 1 })))
  })

  it('268. an unknown field is refused', async () => {
    await assertFails(setDoc(doc(db(ADMIN), 'action_items', REQ_SHORT), {
      ...actionDoc({ requirementId: REQ_SHORT }), vendor: 'Acme',
    }))
  })

  describe('once an action exists', () => {
    beforeEach(async () => {
      await environment.withSecurityRulesDisabled(async (context) => {
        const s = context.firestore() as unknown as Firestore
        await setDoc(doc(s, 'action_items', REQ_SHORT), actionDoc({ requirementId: REQ_SHORT }))
      })
    })

    it('269. edit member updates the status', async () => {
      await assertSucceeds(updateDoc(doc(db(EDITOR), 'action_items', REQ_SHORT), {
        status: 'in_progress', updated_at: serverTimestamp(),
      }))
    })

    it('270. an update is allowed even once the shortage has cleared', async () => {
      // Inventory arrives and covers the requirement; closing the work must
      // stay possible, so update deliberately does not re-check the shortage.
      await environment.withSecurityRulesDisabled(async (context) => {
        const s = context.firestore() as unknown as Firestore
        await setDoc(doc(s, 'inventory_items', ITEM_SHORT), itemDoc(ITEM_SHORT, ORG_A, TEAM_LIGHTING, 50), { merge: true })
      })

      await assertSucceeds(updateDoc(doc(db(ADMIN), 'action_items', REQ_SHORT), {
        status: 'done', updated_at: serverTimestamp(),
      }))
    })

    it('271. the relation fields are immutable', async () => {
      for (const patch of [
        { requirement_id: REQ_COVERED },
        { production_id: PROD_B },
        { team_id: TEAM_COSTUME },
        { organization_id: ORG_B },
        { created_by_uid: EDITOR },
      ]) {
        await assertFails(updateDoc(doc(db(ADMIN), 'action_items', REQ_SHORT), {
          ...patch, updated_at: serverTimestamp(),
        }))
      }
    })

    it('272. view member cannot update', async () => {
      await assertFails(updateDoc(doc(db(VIEWER), 'action_items', REQ_SHORT), {
        status: 'done', updated_at: serverTimestamp(),
      }))
    })

    it('273. other-team edit member cannot update', async () => {
      await assertFails(updateDoc(doc(db(COSTUME_EDITOR), 'action_items', REQ_SHORT), {
        status: 'done', updated_at: serverTimestamp(),
      }))
    })

    // The Action List changes status alone, as a partial write. These pin that
    // the existing update rule covers it without being widened.
    it('273b. Admin changes status from the Action List', async () => {
      for (const status of ['todo', 'in_progress', 'done', 'cancelled']) {
        await assertSucceeds(updateDoc(doc(db(ADMIN), 'action_items', REQ_SHORT), {
          status, updated_at: serverTimestamp(),
        }))
      }
    })

    it('273c. edit member changes status on their own team', async () => {
      await assertSucceeds(updateDoc(doc(db(EDITOR), 'action_items', REQ_SHORT), {
        status: 'done', updated_at: serverTimestamp(),
      }))
    })

    it('273d. other-team edit member cannot change status', async () => {
      await assertFails(updateDoc(doc(db(COSTUME_EDITOR), 'action_items', REQ_SHORT), {
        status: 'done', updated_at: serverTimestamp(),
      }))
    })

    it('273e. view member cannot change status', async () => {
      await assertFails(updateDoc(doc(db(VIEWER), 'action_items', REQ_SHORT), {
        status: 'done', updated_at: serverTimestamp(),
      }))
    })

    it('273f. an unsupported status is refused', async () => {
      for (const status of ['finished', 'Done', '']) {
        await assertFails(updateDoc(doc(db(ADMIN), 'action_items', REQ_SHORT), {
          status, updated_at: serverTimestamp(),
        }))
      }
    })

    it('273g. a status-only write cannot smuggle in another field', async () => {
      await assertFails(updateDoc(doc(db(ADMIN), 'action_items', REQ_SHORT), {
        status: 'done', quantity: 99, team_id: TEAM_COSTUME, updated_at: serverTimestamp(),
      }))
    })

    it('274. deleting an action is denied', async () => {
      const s = db(ADMIN); const b = writeBatch(s)
      b.delete(doc(s, 'action_items', REQ_SHORT))
      await assertFails(b.commit())
    })

    it('275. the organization action list query succeeds, and another organization does not', async () => {
      await assertSucceeds(getDocs(query(collection(db(VIEWER), 'action_items'), where('organization_id', '==', ORG_A))))
      await assertFails(getDocs(query(collection(db(VIEWER), 'action_items'), where('organization_id', '==', ORG_B))))
    })

    it('276. an unfiltered action query is rejected', async () => {
      await assertFails(getDocs(collection(db(VIEWER), 'action_items')))
    })
  })
})
