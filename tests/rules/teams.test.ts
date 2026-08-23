import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest'
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
import {
  ADMIN,
  CODE_A,
  CODE_B,
  MEMBER,
  ORG_A,
  ORG_B,
  OUTSIDER,
  assertFails,
  assertSucceeds,
  createTestEnvironment,
  membershipId,
  seedOrganization,
} from './helpers'

let environment: RulesTestEnvironment

const TEAM_A = 'teamAAAAAAAAAAAAAAAA'
const TEAM_B = 'teamBBBBBBBBBBBBBBBB'

beforeAll(async () => {
  environment = await createTestEnvironment()
})
afterAll(async () => environment.cleanup())

beforeEach(async () => {
  await environment.clearFirestore()
  await seedOrganization(environment, {
    organizationId: ORG_A,
    adminUid: ADMIN,
    code: CODE_A,
    members: [{ uid: MEMBER, assigned: true }],
  })
  await seedOrganization(environment, { organizationId: ORG_B, adminUid: OUTSIDER, code: CODE_B })

  await environment.withSecurityRulesDisabled(async (context) => {
    const store = context.firestore() as unknown as Firestore
    await setDoc(doc(store, 'teams', TEAM_A), {
      team_id: TEAM_A,
      organization_id: ORG_A,
      name: 'Lighting',
      created_at: serverTimestamp(),
      updated_at: serverTimestamp(),
    })
    await setDoc(doc(store, 'teams', TEAM_B), {
      team_id: TEAM_B,
      organization_id: ORG_B,
      name: 'Sound',
      created_at: serverTimestamp(),
      updated_at: serverTimestamp(),
    })
  })
})

function db(uid: string | null): Firestore {
  const context = uid ? environment.authenticatedContext(uid) : environment.unauthenticatedContext()
  return context.firestore() as unknown as Firestore
}

function newTeam(organizationId: string, teamId: string, name = 'Props') {
  return {
    team_id: teamId,
    organization_id: organizationId,
    name,
    created_at: serverTimestamp(),
    updated_at: serverTimestamp(),
  }
}

describe('teams', () => {
  it('98. lets an active member read a team in their organization', async () => {
    await assertSucceeds(getDoc(doc(db(MEMBER), 'teams', TEAM_A)))
  })

  it('99. lets an active member query their organization teams', async () => {
    await assertSucceeds(
      getDocs(query(collection(db(MEMBER), 'teams'), where('organization_id', '==', ORG_A))),
    )
  })

  it('100. rejects querying teams of another organization', async () => {
    await assertFails(
      getDocs(query(collection(db(MEMBER), 'teams'), where('organization_id', '==', ORG_B))),
    )
  })

  it('101. rejects listing all teams without an organization filter', async () => {
    await assertFails(getDocs(collection(db(MEMBER), 'teams')))
  })

  it('102. rejects an unauthenticated read', async () => {
    await assertFails(getDoc(doc(db(null), 'teams', TEAM_A)))
  })

  it('103. lets the Admin create a team', async () => {
    const newId = 'teamNEWNEWNEWNEWNEW1'
    await assertSucceeds(setDoc(doc(db(ADMIN), 'teams', newId), newTeam(ORG_A, newId)))
  })

  it('104. rejects a team created by an ordinary member', async () => {
    const newId = 'teamNEWNEWNEWNEWNEW2'
    await assertFails(setDoc(doc(db(MEMBER), 'teams', newId), newTeam(ORG_A, newId)))
  })

  it('105. rejects a team created by an Admin of another organization', async () => {
    const newId = 'teamNEWNEWNEWNEWNEW3'
    await assertFails(setDoc(doc(db(OUTSIDER), 'teams', newId), newTeam(ORG_A, newId)))
  })

  it('106. rejects a team whose document ID does not match team_id', async () => {
    await assertFails(
      setDoc(doc(db(ADMIN), 'teams', 'teamMISMATCHMISMATCH'), newTeam(ORG_A, 'teamSOMETHINGELSE01')),
    )
  })

  it('107. rejects an empty team name', async () => {
    const newId = 'teamNEWNEWNEWNEWNEW4'
    await assertFails(setDoc(doc(db(ADMIN), 'teams', newId), newTeam(ORG_A, newId, '')))
  })

  it('108. rejects a team carrying an unknown field', async () => {
    const newId = 'teamNEWNEWNEWNEWNEW5'
    await assertFails(
      setDoc(doc(db(ADMIN), 'teams', newId), { ...newTeam(ORG_A, newId), is_secret: true }),
    )
  })

  it('109. lets the Admin rename a team', async () => {
    await assertSucceeds(
      updateDoc(doc(db(ADMIN), 'teams', TEAM_A), {
        name: 'Lighting & Rigging',
        updated_at: serverTimestamp(),
      }),
    )
  })

  it('110. rejects a rename by an ordinary member', async () => {
    await assertFails(
      updateDoc(doc(db(MEMBER), 'teams', TEAM_A), {
        name: 'Hijacked',
        updated_at: serverTimestamp(),
      }),
    )
  })

  it('111. rejects moving a team to another organization', async () => {
    await assertFails(
      updateDoc(doc(db(ADMIN), 'teams', TEAM_A), {
        organization_id: ORG_B,
        updated_at: serverTimestamp(),
      }),
    )
  })

  it('112. rejects deleting a team', async () => {
    const store = db(ADMIN)
    const batch = writeBatch(store)
    batch.delete(doc(store, 'teams', TEAM_A))
    await assertFails(batch.commit())
  })

  it('113. rejects a deactivated member reading teams', async () => {
    await environment.withSecurityRulesDisabled(async (context) => {
      const store = context.firestore() as unknown as Firestore
      await setDoc(
        doc(store, 'organization_memberships', membershipId(ORG_A, MEMBER)),
        { is_active: false },
        { merge: true },
      )
    })
    await assertFails(getDoc(doc(db(MEMBER), 'teams', TEAM_A)))
  })
})
