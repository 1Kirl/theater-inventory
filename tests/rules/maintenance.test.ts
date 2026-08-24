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
  writeBatch,
  type Firestore,
} from 'firebase/firestore'
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { buildInventoryItemDocument } from '@/domain/inventory-payloads'
import { buildMaintenanceDocument } from '@/domain/maintenance-payloads'
import { EMPTY_CONDITION_COUNTS } from '@/domain/inventory'
import {
  ADMIN,
  CODE_A,
  CODE_B,
  ORG_A,
  ORG_B,
  OUTSIDER,
  TEAM_COSTUME,
  TEAM_LIGHTING,
  TEAM_OTHER_ORG,
  assertFails,
  assertSucceeds,
  createTestEnvironment,
  seedMembership,
  seedOrganization,
  seedTeam,
} from './helpers'

let environment: RulesTestEnvironment

const VIEWER = 'uid-maint-viewer'
const EDITOR = 'uid-maint-editor'
const COSTUME_EDITOR = 'uid-maint-costume'
const NO_ACCESS = 'uid-maint-none'
const DEACTIVATED = 'uid-maint-deactivated'

const ITEM_LIGHTING = 'itemLIGHTINGAAAAAAAA'
const ITEM_COSTUME = 'itemCOSTUMEBBBBBBBBB'
const ITEM_OTHER_ORG = 'itemOTHERORGCCCCCCCC'

const RECORD_LIGHTING = 'maintLIGHTINGAAAAAA1'
const RECORD_COSTUME = 'maintCOSTUMEBBBBBBB1'
const RECORD_OTHER_ORG = 'maintOTHERORGCCCCCC1'

const VIEW_MAINT = {
  inventory: 'view',
  maintenance: 'view',
  productions: 'none',
  calendar: 'none',
} as const

const EDIT_MAINT = {
  inventory: 'view',
  maintenance: 'edit',
  productions: 'none',
  calendar: 'none',
} as const

const NO_MAINT = {
  inventory: 'edit',
  maintenance: 'none',
  productions: 'none',
  calendar: 'none',
} as const

beforeAll(async () => {
  environment = await createTestEnvironment()
})
afterAll(async () => environment.cleanup())

function db(uid: string | null): Firestore {
  const context = uid ? environment.authenticatedContext(uid) : environment.unauthenticatedContext()
  return context.firestore() as unknown as Firestore
}

function itemDoc(itemId: string, organizationId: string, teamId: string, uid: string, total = 10) {
  return buildInventoryItemDocument({
    itemId,
    organizationId,
    uid,
    now: serverTimestamp,
    input: {
      name: 'Source Four',
      category: 'Lighting Instruments',
      teamId,
      quantityTotal: total,
      quantityAvailable: total,
      conditionCounts: { ...EMPTY_CONDITION_COUNTS, good: total },
      location: 'Storage A',
    },
  })
}

/** The same payload the maintenance service builds. */
function recordDoc(
  overrides: Partial<{
    maintenanceId: string
    organizationId: string
    itemId: string
    teamId: string
    uid: string
    quantitySent: number
    status: string
  }> = {},
) {
  return buildMaintenanceDocument({
    maintenanceId: overrides.maintenanceId ?? RECORD_LIGHTING,
    organizationId: overrides.organizationId ?? ORG_A,
    itemId: overrides.itemId ?? ITEM_LIGHTING,
    teamId: overrides.teamId ?? TEAM_LIGHTING,
    uid: overrides.uid ?? ADMIN,
    now: serverTimestamp,
    input: {
      quantitySent: overrides.quantitySent ?? 2,
      issueDescription: 'Lamp housing cracked',
      status: (overrides.status ?? 'sent') as 'sent',
      serviceProviderName: 'City Stage Service',
      serviceProviderPhone: '555-0100',
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

  await seedMembership(environment, { organizationId: ORG_A, uid: VIEWER, teamIds: [TEAM_LIGHTING], permissions: VIEW_MAINT })
  await seedMembership(environment, { organizationId: ORG_A, uid: EDITOR, teamIds: [TEAM_LIGHTING], permissions: EDIT_MAINT })
  await seedMembership(environment, { organizationId: ORG_A, uid: COSTUME_EDITOR, teamIds: [TEAM_COSTUME], permissions: EDIT_MAINT })
  await seedMembership(environment, { organizationId: ORG_A, uid: NO_ACCESS, teamIds: [TEAM_LIGHTING], permissions: NO_MAINT })
  await seedMembership(environment, { organizationId: ORG_A, uid: DEACTIVATED, teamIds: [TEAM_LIGHTING], permissions: EDIT_MAINT, isActive: false })

  await environment.withSecurityRulesDisabled(async (context) => {
    const store = context.firestore() as unknown as Firestore
    await setDoc(doc(store, 'inventory_items', ITEM_LIGHTING), itemDoc(ITEM_LIGHTING, ORG_A, TEAM_LIGHTING, ADMIN))
    await setDoc(doc(store, 'inventory_items', ITEM_COSTUME), itemDoc(ITEM_COSTUME, ORG_A, TEAM_COSTUME, ADMIN))
    await setDoc(doc(store, 'inventory_items', ITEM_OTHER_ORG), itemDoc(ITEM_OTHER_ORG, ORG_B, TEAM_OTHER_ORG, OUTSIDER))

    await setDoc(doc(store, 'maintenance_records', RECORD_LIGHTING), recordDoc())
    await setDoc(doc(store, 'maintenance_records', RECORD_COSTUME), recordDoc({ maintenanceId: RECORD_COSTUME, itemId: ITEM_COSTUME, teamId: TEAM_COSTUME }))
    await setDoc(doc(store, 'maintenance_records', RECORD_OTHER_ORG), recordDoc({ maintenanceId: RECORD_OTHER_ORG, organizationId: ORG_B, itemId: ITEM_OTHER_ORG, teamId: TEAM_OTHER_ORG, uid: OUTSIDER }))
  })
})

describe('maintenance read', () => {
  it('178. Admin reads a record in their organization', async () => {
    await assertSucceeds(getDoc(doc(db(ADMIN), 'maintenance_records', RECORD_LIGHTING)))
  })

  it('179. view member reads a record', async () => {
    await assertSucceeds(getDoc(doc(db(VIEWER), 'maintenance_records', RECORD_LIGHTING)))
  })

  it('180. view member reads a record from another team, because reading is organization-wide', async () => {
    await assertSucceeds(getDoc(doc(db(VIEWER), 'maintenance_records', RECORD_COSTUME)))
  })

  it('181. edit member reads a record from another team', async () => {
    await assertSucceeds(getDoc(doc(db(EDITOR), 'maintenance_records', RECORD_COSTUME)))
  })

  it('182. a member with maintenance none is denied, even holding inventory edit', async () => {
    await assertFails(getDoc(doc(db(NO_ACCESS), 'maintenance_records', RECORD_LIGHTING)))
  })

  it('183. a deactivated membership is denied', async () => {
    await assertFails(getDoc(doc(db(DEACTIVATED), 'maintenance_records', RECORD_LIGHTING)))
  })

  it('184. another organization cannot be read', async () => {
    await assertFails(getDoc(doc(db(ADMIN), 'maintenance_records', RECORD_OTHER_ORG)))
  })

  it('185. an unauthenticated caller is denied', async () => {
    await assertFails(getDoc(doc(db(null), 'maintenance_records', RECORD_LIGHTING)))
  })
})

describe('maintenance queries', () => {
  function listQuery(store: Firestore, organizationId: string) {
    return query(collection(store, 'maintenance_records'), where('organization_id', '==', organizationId))
  }

  function itemHistoryQuery(store: Firestore, organizationId: string, itemId: string) {
    return query(
      collection(store, 'maintenance_records'),
      where('organization_id', '==', organizationId),
      where('item_id', '==', itemId),
    )
  }

  it('186. the organization-wide list query succeeds for every role that holds the module', async () => {
    for (const uid of [ADMIN, VIEWER, EDITOR]) {
      const snapshot = await assertSucceeds(getDocs(listQuery(db(uid), ORG_A)))
      expect(snapshot.size).toBe(2)
    }
  })

  it('187. the item history query succeeds and is scoped to one item', async () => {
    const snapshot = await assertSucceeds(getDocs(itemHistoryQuery(db(VIEWER), ORG_A, ITEM_LIGHTING)))
    expect(snapshot.size).toBe(1)
  })

  it('188. a member with maintenance none cannot query', async () => {
    await assertFails(getDocs(listQuery(db(NO_ACCESS), ORG_A)))
  })

  it('189. another organization cannot be queried', async () => {
    await assertFails(getDocs(listQuery(db(VIEWER), ORG_B)))
  })

  it('190. an unfiltered query across all organizations is rejected', async () => {
    await assertFails(getDocs(collection(db(VIEWER), 'maintenance_records')))
  })
})

describe('maintenance create', () => {
  const NEW_RECORD = 'maintNEWNEWNEWNEWNE1'

  it('191. Admin creates a record on any team', async () => {
    await assertSucceeds(
      setDoc(doc(db(ADMIN), 'maintenance_records', NEW_RECORD), recordDoc({ maintenanceId: NEW_RECORD, itemId: ITEM_COSTUME, teamId: TEAM_COSTUME, uid: ADMIN })),
    )
  })

  it('192. edit member creates a record for their own team item', async () => {
    await assertSucceeds(
      setDoc(doc(db(EDITOR), 'maintenance_records', NEW_RECORD), recordDoc({ maintenanceId: NEW_RECORD, uid: EDITOR })),
    )
  })

  it('193. view member cannot create', async () => {
    await assertFails(
      setDoc(doc(db(VIEWER), 'maintenance_records', NEW_RECORD), recordDoc({ maintenanceId: NEW_RECORD, uid: VIEWER })),
    )
  })

  it('194. edit member cannot create for another team item', async () => {
    await assertFails(
      setDoc(doc(db(EDITOR), 'maintenance_records', NEW_RECORD), recordDoc({ maintenanceId: NEW_RECORD, itemId: ITEM_COSTUME, teamId: TEAM_COSTUME, uid: EDITOR })),
    )
  })

  it('195. a forged team_id that does not match the item is rejected', async () => {
    // Claiming the lighting team for a costume item would hand edit rights to
    // the wrong crew.
    await assertFails(
      setDoc(doc(db(EDITOR), 'maintenance_records', NEW_RECORD), recordDoc({ maintenanceId: NEW_RECORD, itemId: ITEM_COSTUME, teamId: TEAM_LIGHTING, uid: EDITOR })),
    )
  })

  it('196. another organization cannot be targeted', async () => {
    await assertFails(
      setDoc(doc(db(ADMIN), 'maintenance_records', NEW_RECORD), recordDoc({ maintenanceId: NEW_RECORD, organizationId: ORG_B, itemId: ITEM_OTHER_ORG, teamId: TEAM_OTHER_ORG, uid: ADMIN })),
    )
  })

  it('197. an item from another organization cannot be linked', async () => {
    await assertFails(
      setDoc(doc(db(ADMIN), 'maintenance_records', NEW_RECORD), recordDoc({ maintenanceId: NEW_RECORD, itemId: ITEM_OTHER_ORG, teamId: TEAM_LIGHTING, uid: ADMIN })),
    )
  })

  it('198. a nonexistent inventory item cannot be linked', async () => {
    await assertFails(
      setDoc(doc(db(ADMIN), 'maintenance_records', NEW_RECORD), recordDoc({ maintenanceId: NEW_RECORD, itemId: 'itemDOESNOTEXIST0000', uid: ADMIN })),
    )
  })

  it('199. quantity zero or negative is rejected', async () => {
    for (const quantity of [0, -1]) {
      await assertFails(
        setDoc(doc(db(ADMIN), 'maintenance_records', NEW_RECORD), recordDoc({ maintenanceId: NEW_RECORD, quantitySent: quantity, uid: ADMIN })),
      )
    }
  })

  it('200. quantity beyond the item total is rejected', async () => {
    await assertFails(
      setDoc(doc(db(ADMIN), 'maintenance_records', NEW_RECORD), recordDoc({ maintenanceId: NEW_RECORD, quantitySent: 11, uid: ADMIN })),
    )
  })

  it('201. quantity equal to the item total is accepted', async () => {
    await assertSucceeds(
      setDoc(doc(db(ADMIN), 'maintenance_records', NEW_RECORD), recordDoc({ maintenanceId: NEW_RECORD, quantitySent: 10, uid: ADMIN })),
    )
  })

  it('202. an unsupported status is rejected', async () => {
    for (const status of ['Sent', 'repairing', 'done']) {
      await assertFails(
        setDoc(doc(db(ADMIN), 'maintenance_records', NEW_RECORD), recordDoc({ maintenanceId: NEW_RECORD, status, uid: ADMIN })),
      )
    }
  })

  it('203. every canonical status is accepted', async () => {
    const statuses = ['planned', 'sent', 'in_service', 'ready', 'returned', 'cancelled']
    for (const [index, status] of statuses.entries()) {
      const id = `maintSTATUS${String(index).padStart(9, '0')}`
      await assertSucceeds(
        setDoc(doc(db(ADMIN), 'maintenance_records', id), recordDoc({ maintenanceId: id, status, uid: ADMIN })),
      )
    }
  })

  it('204. an unknown field is rejected', async () => {
    await assertFails(
      setDoc(doc(db(ADMIN), 'maintenance_records', NEW_RECORD), {
        ...recordDoc({ maintenanceId: NEW_RECORD, uid: ADMIN }),
        priority: 'urgent',
      }),
    )
  })

  it('205. a document ID that disagrees with maintenance_id is rejected', async () => {
    await assertFails(
      setDoc(doc(db(ADMIN), 'maintenance_records', 'maintMISMATCHMISMATC'), recordDoc({ maintenanceId: NEW_RECORD, uid: ADMIN })),
    )
  })

  it('206. created_by_uid naming somebody else is rejected', async () => {
    await assertFails(
      setDoc(doc(db(EDITOR), 'maintenance_records', NEW_RECORD), recordDoc({ maintenanceId: NEW_RECORD, uid: ADMIN })),
    )
  })

  it('207. an empty issue description is rejected', async () => {
    await assertFails(
      setDoc(doc(db(ADMIN), 'maintenance_records', NEW_RECORD), {
        ...recordDoc({ maintenanceId: NEW_RECORD, uid: ADMIN }),
        issue_description: '',
      }),
    )
  })

  it('208. an unsupported return method is rejected', async () => {
    await assertFails(
      setDoc(doc(db(ADMIN), 'maintenance_records', NEW_RECORD), {
        ...recordDoc({ maintenanceId: NEW_RECORD, uid: ADMIN }),
        return_method: 'courier',
      }),
    )
  })

  it('209. a negative cost is rejected', async () => {
    await assertFails(
      setDoc(doc(db(ADMIN), 'maintenance_records', NEW_RECORD), {
        ...recordDoc({ maintenanceId: NEW_RECORD, uid: ADMIN }),
        cost: -5,
      }),
    )
  })

  it('210. the aggregate across active records is not enforced, only warned about', async () => {
    // Two records of 6 against a total of 10. Rules cannot aggregate siblings,
    // so this is accepted; the interface is what warns. See decision 45.
    const first = 'maintAGGREGATEAAAAA1'
    const second = 'maintAGGREGATEAAAAA2'

    await assertSucceeds(
      setDoc(doc(db(ADMIN), 'maintenance_records', first), recordDoc({ maintenanceId: first, quantitySent: 6, uid: ADMIN })),
    )
    await assertSucceeds(
      setDoc(doc(db(ADMIN), 'maintenance_records', second), recordDoc({ maintenanceId: second, quantitySent: 6, uid: ADMIN })),
    )
  })
})

describe('maintenance update', () => {
  it('211. Admin updates a record', async () => {
    await assertSucceeds(
      updateDoc(doc(db(ADMIN), 'maintenance_records', RECORD_LIGHTING), {
        status: 'in_service',
        updated_at: serverTimestamp(),
      }),
    )
  })

  it('212. edit member updates a record on their own team snapshot', async () => {
    await assertSucceeds(
      updateDoc(doc(db(EDITOR), 'maintenance_records', RECORD_LIGHTING), {
        status: 'ready',
        updated_at: serverTimestamp(),
      }),
    )
  })

  it('213. view member cannot update', async () => {
    await assertFails(
      updateDoc(doc(db(VIEWER), 'maintenance_records', RECORD_LIGHTING), {
        status: 'ready',
        updated_at: serverTimestamp(),
      }),
    )
  })

  it('214. edit member on another team cannot update', async () => {
    await assertFails(
      updateDoc(doc(db(COSTUME_EDITOR), 'maintenance_records', RECORD_LIGHTING), {
        status: 'ready',
        updated_at: serverTimestamp(),
      }),
    )
  })

  it('215. the team snapshot cannot be changed', async () => {
    await assertFails(
      updateDoc(doc(db(ADMIN), 'maintenance_records', RECORD_LIGHTING), {
        team_id: TEAM_COSTUME,
        updated_at: serverTimestamp(),
      }),
    )
  })

  it('216. organization_id cannot be changed', async () => {
    await assertFails(
      updateDoc(doc(db(ADMIN), 'maintenance_records', RECORD_LIGHTING), {
        organization_id: ORG_B,
        updated_at: serverTimestamp(),
      }),
    )
  })

  it('217. the linked item cannot be changed', async () => {
    await assertFails(
      updateDoc(doc(db(ADMIN), 'maintenance_records', RECORD_LIGHTING), {
        item_id: ITEM_COSTUME,
        updated_at: serverTimestamp(),
      }),
    )
  })

  it('218. created_by_uid and created_at cannot be changed', async () => {
    await assertFails(
      updateDoc(doc(db(ADMIN), 'maintenance_records', RECORD_LIGHTING), {
        created_by_uid: EDITOR,
        updated_at: serverTimestamp(),
      }),
    )
    await assertFails(
      updateDoc(doc(db(ADMIN), 'maintenance_records', RECORD_LIGHTING), {
        created_at: serverTimestamp(),
        updated_at: serverTimestamp(),
      }),
    )
  })

  it('219. an invalid quantity is rejected', async () => {
    for (const quantity of [0, -2, 11]) {
      await assertFails(
        updateDoc(doc(db(ADMIN), 'maintenance_records', RECORD_LIGHTING), {
          quantity_sent: quantity,
          updated_at: serverTimestamp(),
        }),
      )
    }
  })

  it('220. an unsupported status is rejected', async () => {
    await assertFails(
      updateDoc(doc(db(ADMIN), 'maintenance_records', RECORD_LIGHTING), {
        status: 'finished',
        updated_at: serverTimestamp(),
      }),
    )
  })

  it('221. an unknown field cannot be added', async () => {
    await assertFails(
      updateDoc(doc(db(ADMIN), 'maintenance_records', RECORD_LIGHTING), {
        priority: 'urgent',
        updated_at: serverTimestamp(),
      }),
    )
  })

  it('222. deleting a maintenance record is denied for everyone', async () => {
    for (const uid of [ADMIN, EDITOR, VIEWER]) {
      const store = db(uid)
      const batch = writeBatch(store)
      batch.delete(doc(store, 'maintenance_records', RECORD_LIGHTING))
      await assertFails(batch.commit())
    }
  })
})
