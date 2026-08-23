import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest'
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
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
})

function db(uid: string | null): Firestore {
  const context = uid ? environment.authenticatedContext(uid) : environment.unauthenticatedContext()
  return context.firestore() as unknown as Firestore
}

describe('enumeration is denied', () => {
  it('57. rejects listing organizations for every role', async () => {
    for (const uid of [ADMIN, MEMBER, OUTSIDER]) {
      await assertFails(getDocs(collection(db(uid), 'organizations')))
    }
  })

  it('58. rejects listing join codes for every role', async () => {
    for (const uid of [ADMIN, MEMBER, OUTSIDER]) {
      await assertFails(getDocs(collection(db(uid), 'organization_join_codes')))
    }
  })

  it('59. rejects listing admin settings for every role', async () => {
    for (const uid of [ADMIN, MEMBER, OUTSIDER]) {
      await assertFails(getDocs(collection(db(uid), 'organization_admin_settings')))
    }
  })

  it('60. rejects listing join proofs for every role', async () => {
    for (const uid of [ADMIN, MEMBER, OUTSIDER]) {
      await assertFails(getDocs(collection(db(uid), 'organization_membership_join_proofs')))
    }
  })

  it('61. rejects listing all memberships without an organization filter', async () => {
    await assertFails(getDocs(collection(db(MEMBER), 'organization_memberships')))
  })

  it('62. rejects listing users', async () => {
    await assertFails(getDocs(collection(db(MEMBER), 'users')))
  })
})

describe('cross-organization isolation', () => {
  it('63. rejects reading another organization document', async () => {
    await assertFails(getDoc(doc(db(MEMBER), 'organizations', ORG_B)))
  })

  it('64. rejects reading another organization admin settings', async () => {
    await assertFails(getDoc(doc(db(MEMBER), 'organization_admin_settings', ORG_B)))
    await assertFails(getDoc(doc(db(ADMIN), 'organization_admin_settings', ORG_B)))
  })

  it('65. rejects an ordinary member reading their own organization admin settings', async () => {
    await assertFails(getDoc(doc(db(MEMBER), 'organization_admin_settings', ORG_A)))
  })

  it('66. lets the Admin read their own organization admin settings', async () => {
    await assertSucceeds(getDoc(doc(db(ADMIN), 'organization_admin_settings', ORG_A)))
  })

  it('67. rejects querying another organization member directory', async () => {
    await assertFails(
      getDocs(
        query(
          collection(db(MEMBER), 'organization_memberships'),
          where('organization_id', '==', ORG_B),
          where('is_active', '==', true),
        ),
      ),
    )
  })

  it('68. rejects writing into another organization', async () => {
    await assertFails(
      updateDoc(doc(db(MEMBER), 'organization_memberships', membershipId(ORG_B, OUTSIDER)), {
        is_active: false,
        updated_at: serverTimestamp(),
      }),
    )
  })

  it('69. rejects an unauthenticated read of an organization', async () => {
    await assertFails(getDoc(doc(db(null), 'organizations', ORG_A)))
  })

  it('70. rejects an unauthenticated read of a membership', async () => {
    await assertFails(
      getDoc(doc(db(null), 'organization_memberships', membershipId(ORG_A, MEMBER))),
    )
  })
})

describe('join proofs', () => {
  beforeEach(async () => {
    await environment.withSecurityRulesDisabled(async (context) => {
      const store = context.firestore() as unknown as Firestore
      const { setDoc } = await import('firebase/firestore')
      await setDoc(doc(store, 'organization_membership_join_proofs', membershipId(ORG_A, MEMBER)), {
        organization_id: ORG_A,
        uid: MEMBER,
        join_code_id: CODE_A,
        created_at: serverTimestamp(),
      })
    })
  })

  it('71. lets the subject read their own proof', async () => {
    await assertSucceeds(
      getDoc(doc(db(MEMBER), 'organization_membership_join_proofs', membershipId(ORG_A, MEMBER))),
    )
  })

  it('72. lets the Admin read a proof in their organization', async () => {
    await assertSucceeds(
      getDoc(doc(db(ADMIN), 'organization_membership_join_proofs', membershipId(ORG_A, MEMBER))),
    )
  })

  it('73. rejects an outsider reading a proof', async () => {
    await assertFails(
      getDoc(doc(db(OUTSIDER), 'organization_membership_join_proofs', membershipId(ORG_A, MEMBER))),
    )
  })

  it('74. rejects updating or deleting a proof', async () => {
    const store = db(MEMBER)
    await assertFails(
      updateDoc(doc(store, 'organization_membership_join_proofs', membershipId(ORG_A, MEMBER)), {
        join_code_id: CODE_B,
      }),
    )
  })
})
