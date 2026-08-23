import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest'
import { doc, setDoc, writeBatch, type Firestore } from 'firebase/firestore'
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing'
import {
  ADMIN,
  MEMBER,
  ORG_A,
  CODE_A,
  assertFails,
  assertSucceeds,
  createTestEnvironment,
  membershipId,
  newAdminSettings,
  newJoinCode,
  newMembership,
  newOrganization,
  SOME_PERMISSIONS,
} from './helpers'

let environment: RulesTestEnvironment

beforeAll(async () => {
  environment = await createTestEnvironment()
})
afterAll(async () => environment.cleanup())
beforeEach(async () => environment.clearFirestore())

function db(uid: string | null): Firestore {
  const context = uid ? environment.authenticatedContext(uid) : environment.unauthenticatedContext()
  return context.firestore() as unknown as Firestore
}

function fullBatch(store: Firestore, uid: string) {
  const batch = writeBatch(store)
  batch.set(doc(store, 'organizations', ORG_A), newOrganization(ORG_A, uid))
  batch.set(doc(store, 'organization_memberships', membershipId(ORG_A, uid)), newMembership(ORG_A, uid))
  batch.set(doc(store, 'organization_join_codes', CODE_A), newJoinCode(ORG_A, uid))
  batch.set(doc(store, 'organization_admin_settings', ORG_A), newAdminSettings(ORG_A, CODE_A))
  return batch
}

describe('create organization', () => {
  it('1. accepts the complete four-document batch', async () => {
    await assertSucceeds(fullBatch(db(ADMIN), ADMIN).commit())
  })

  it('2. rejects an unauthenticated caller', async () => {
    await assertFails(fullBatch(db(null), ADMIN).commit())
  })

  it('3. rejects the organization document alone', async () => {
    const store = db(ADMIN)
    await assertFails(setDoc(doc(store, 'organizations', ORG_A), newOrganization(ORG_A, ADMIN)))
  })

  it('4. rejects a membership alone, with no organization in the batch', async () => {
    const store = db(ADMIN)
    await assertFails(
      setDoc(doc(store, 'organization_memberships', membershipId(ORG_A, ADMIN)), newMembership(ORG_A, ADMIN)),
    )
  })

  it('5. rejects a join code alone', async () => {
    const store = db(ADMIN)
    await assertFails(setDoc(doc(store, 'organization_join_codes', CODE_A), newJoinCode(ORG_A, ADMIN)))
  })

  it('6. rejects admin settings alone', async () => {
    const store = db(ADMIN)
    await assertFails(
      setDoc(doc(store, 'organization_admin_settings', ORG_A), newAdminSettings(ORG_A, CODE_A)),
    )
  })

  it('7. rejects a batch missing the admin settings', async () => {
    const store = db(ADMIN)
    const batch = writeBatch(store)
    batch.set(doc(store, 'organizations', ORG_A), newOrganization(ORG_A, ADMIN))
    batch.set(doc(store, 'organization_memberships', membershipId(ORG_A, ADMIN)), newMembership(ORG_A, ADMIN))
    batch.set(doc(store, 'organization_join_codes', CODE_A), newJoinCode(ORG_A, ADMIN))
    await assertFails(batch.commit())
  })

  it('8. rejects a batch naming somebody else as admin_uid', async () => {
    const store = db(ADMIN)
    const batch = writeBatch(store)
    batch.set(doc(store, 'organizations', ORG_A), {
      ...newOrganization(ORG_A, ADMIN),
      admin_uid: MEMBER,
    })
    batch.set(doc(store, 'organization_memberships', membershipId(ORG_A, ADMIN)), newMembership(ORG_A, ADMIN))
    batch.set(doc(store, 'organization_join_codes', CODE_A), newJoinCode(ORG_A, ADMIN))
    batch.set(doc(store, 'organization_admin_settings', ORG_A), newAdminSettings(ORG_A, CODE_A))
    await assertFails(batch.commit())
  })

  it('9. rejects a forged creator membership carrying permissions', async () => {
    const store = db(ADMIN)
    const batch = writeBatch(store)
    batch.set(doc(store, 'organizations', ORG_A), newOrganization(ORG_A, ADMIN))
    batch.set(doc(store, 'organization_memberships', membershipId(ORG_A, ADMIN)), {
      ...newMembership(ORG_A, ADMIN),
      team_ids: ['team-lighting'],
      permissions: SOME_PERMISSIONS,
    })
    batch.set(doc(store, 'organization_join_codes', CODE_A), newJoinCode(ORG_A, ADMIN))
    batch.set(doc(store, 'organization_admin_settings', ORG_A), newAdminSettings(ORG_A, CODE_A))
    await assertFails(batch.commit())
  })

  it('10. rejects admin settings pointing at a code for another organization', async () => {
    const store = db(ADMIN)
    const batch = writeBatch(store)
    batch.set(doc(store, 'organizations', ORG_A), newOrganization(ORG_A, ADMIN))
    batch.set(doc(store, 'organization_memberships', membershipId(ORG_A, ADMIN)), newMembership(ORG_A, ADMIN))
    batch.set(doc(store, 'organization_join_codes', CODE_A), newJoinCode('someOtherOrganization', ADMIN))
    batch.set(doc(store, 'organization_admin_settings', ORG_A), newAdminSettings(ORG_A, CODE_A))
    await assertFails(batch.commit())
  })

  it('11. rejects a malformed join code document ID', async () => {
    const store = db(ADMIN)
    const badCode = 'lowercase-and-short'
    const batch = writeBatch(store)
    batch.set(doc(store, 'organizations', ORG_A), newOrganization(ORG_A, ADMIN))
    batch.set(doc(store, 'organization_memberships', membershipId(ORG_A, ADMIN)), newMembership(ORG_A, ADMIN))
    batch.set(doc(store, 'organization_join_codes', badCode), newJoinCode(ORG_A, ADMIN))
    batch.set(doc(store, 'organization_admin_settings', ORG_A), newAdminSettings(ORG_A, badCode))
    await assertFails(batch.commit())
  })

  it('12. rejects a membership whose document ID does not match its fields', async () => {
    const store = db(ADMIN)
    const batch = writeBatch(store)
    batch.set(doc(store, 'organizations', ORG_A), newOrganization(ORG_A, ADMIN))
    batch.set(doc(store, 'organization_memberships', membershipId(ORG_A, ADMIN)), {
      ...newMembership(ORG_A, ADMIN),
      uid: MEMBER,
    })
    batch.set(doc(store, 'organization_join_codes', CODE_A), newJoinCode(ORG_A, ADMIN))
    batch.set(doc(store, 'organization_admin_settings', ORG_A), newAdminSettings(ORG_A, CODE_A))
    await assertFails(batch.commit())
  })

  it('13. rejects an empty organization name', async () => {
    const store = db(ADMIN)
    const batch = writeBatch(store)
    batch.set(doc(store, 'organizations', ORG_A), { ...newOrganization(ORG_A, ADMIN), name: '' })
    batch.set(doc(store, 'organization_memberships', membershipId(ORG_A, ADMIN)), newMembership(ORG_A, ADMIN))
    batch.set(doc(store, 'organization_join_codes', CODE_A), newJoinCode(ORG_A, ADMIN))
    batch.set(doc(store, 'organization_admin_settings', ORG_A), newAdminSettings(ORG_A, CODE_A))
    await assertFails(batch.commit())
  })
})

describe('strict schema', () => {
  it('14. rejects an organization document carrying an unknown field', async () => {
    const store = db(ADMIN)
    const batch = writeBatch(store)
    batch.set(doc(store, 'organizations', ORG_A), {
      ...newOrganization(ORG_A, ADMIN),
      is_premium: true,
    })
    batch.set(doc(store, 'organization_memberships', membershipId(ORG_A, ADMIN)), newMembership(ORG_A, ADMIN))
    batch.set(doc(store, 'organization_join_codes', CODE_A), newJoinCode(ORG_A, ADMIN))
    batch.set(doc(store, 'organization_admin_settings', ORG_A), newAdminSettings(ORG_A, CODE_A))
    await assertFails(batch.commit())
  })

  it('15. rejects a membership carrying a role field', async () => {
    const store = db(ADMIN)
    const batch = writeBatch(store)
    batch.set(doc(store, 'organizations', ORG_A), newOrganization(ORG_A, ADMIN))
    batch.set(doc(store, 'organization_memberships', membershipId(ORG_A, ADMIN)), {
      ...newMembership(ORG_A, ADMIN),
      role: 'admin',
    })
    batch.set(doc(store, 'organization_join_codes', CODE_A), newJoinCode(ORG_A, ADMIN))
    batch.set(doc(store, 'organization_admin_settings', ORG_A), newAdminSettings(ORG_A, CODE_A))
    await assertFails(batch.commit())
  })

  it('16. accepts an optional description', async () => {
    const store = db(ADMIN)
    const batch = writeBatch(store)
    batch.set(doc(store, 'organizations', ORG_A), {
      ...newOrganization(ORG_A, ADMIN),
      description: 'High school theater department',
    })
    batch.set(doc(store, 'organization_memberships', membershipId(ORG_A, ADMIN)), newMembership(ORG_A, ADMIN))
    batch.set(doc(store, 'organization_join_codes', CODE_A), newJoinCode(ORG_A, ADMIN))
    batch.set(doc(store, 'organization_admin_settings', ORG_A), newAdminSettings(ORG_A, CODE_A))
    await assertSucceeds(batch.commit())
  })
})
