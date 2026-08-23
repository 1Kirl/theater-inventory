import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest'
import { doc, serverTimestamp, updateDoc, writeBatch, type Firestore } from 'firebase/firestore'
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing'
import {
  ADMIN,
  CODE_A,
  CODE_B,
  MEMBER,
  NO_PERMISSIONS,
  ORG_A,
  ORG_B,
  OUTSIDER,
  SOME_PERMISSIONS,
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
    name: 'Riverside Theater',
    members: [{ uid: MEMBER, assigned: true }],
  })
  await seedOrganization(environment, { organizationId: ORG_B, adminUid: OUTSIDER, code: CODE_B })
})

function db(uid: string | null): Firestore {
  const context = uid ? environment.authenticatedContext(uid) : environment.unauthenticatedContext()
  return context.firestore() as unknown as Firestore
}

describe('membership assignment', () => {
  it('27. lets the Admin assign teams and permissions', async () => {
    const store = db(ADMIN)
    await assertSucceeds(
      updateDoc(doc(store, 'organization_memberships', membershipId(ORG_A, MEMBER)), {
        team_ids: ['team-sound'],
        permissions: SOME_PERMISSIONS,
        updated_at: serverTimestamp(),
      }),
    )
  })

  it('28. rejects a member editing their own membership', async () => {
    const store = db(MEMBER)
    await assertFails(
      updateDoc(doc(store, 'organization_memberships', membershipId(ORG_A, MEMBER)), {
        team_ids: ['team-sound'],
        permissions: SOME_PERMISSIONS,
        updated_at: serverTimestamp(),
      }),
    )
  })

  it('29. rejects an Admin of another organization', async () => {
    const store = db(OUTSIDER)
    await assertFails(
      updateDoc(doc(store, 'organization_memberships', membershipId(ORG_A, MEMBER)), {
        team_ids: ['team-sound'],
        permissions: SOME_PERMISSIONS,
        updated_at: serverTimestamp(),
      }),
    )
  })

  it('30. rejects changing organization_id or uid', async () => {
    const store = db(ADMIN)
    await assertFails(
      updateDoc(doc(store, 'organization_memberships', membershipId(ORG_A, MEMBER)), {
        organization_id: ORG_B,
        updated_at: serverTimestamp(),
      }),
    )
    await assertFails(
      updateDoc(doc(store, 'organization_memberships', membershipId(ORG_A, MEMBER)), {
        uid: OUTSIDER,
        updated_at: serverTimestamp(),
      }),
    )
  })

  it('31. rejects an invalid permission level', async () => {
    const store = db(ADMIN)
    await assertFails(
      updateDoc(doc(store, 'organization_memberships', membershipId(ORG_A, MEMBER)), {
        permissions: { ...NO_PERMISSIONS, inventory: 'owner' },
        updated_at: serverTimestamp(),
      }),
    )
  })

  it('32. lets the Admin deactivate an ordinary member', async () => {
    const store = db(ADMIN)
    await assertSucceeds(
      updateDoc(doc(store, 'organization_memberships', membershipId(ORG_A, MEMBER)), {
        is_active: false,
        updated_at: serverTimestamp(),
      }),
    )
  })

  it('33. rejects deactivating the current Admin', async () => {
    const store = db(ADMIN)
    await assertFails(
      updateDoc(doc(store, 'organization_memberships', membershipId(ORG_A, ADMIN)), {
        is_active: false,
        updated_at: serverTimestamp(),
      }),
    )
  })

  it('34. rejects deleting a membership', async () => {
    const store = db(ADMIN)
    const batch = writeBatch(store)
    batch.delete(doc(store, 'organization_memberships', membershipId(ORG_A, MEMBER)))
    await assertFails(batch.commit())
  })
})

describe('admin transfer', () => {
  it('35. lets the current Admin transfer to an active member', async () => {
    const store = db(ADMIN)
    await assertSucceeds(
      updateDoc(doc(store, 'organizations', ORG_A), {
        admin_uid: MEMBER,
        updated_at: serverTimestamp(),
      }),
    )
  })

  it('36. rejects a transfer initiated by a non-Admin', async () => {
    const store = db(MEMBER)
    await assertFails(
      updateDoc(doc(store, 'organizations', ORG_A), {
        admin_uid: MEMBER,
        updated_at: serverTimestamp(),
      }),
    )
  })

  it('37. rejects a transfer to a user with no membership', async () => {
    const store = db(ADMIN)
    await assertFails(
      updateDoc(doc(store, 'organizations', ORG_A), {
        admin_uid: OUTSIDER,
        updated_at: serverTimestamp(),
      }),
    )
  })

  it('38. rejects a transfer to a deactivated member', async () => {
    const store = db(ADMIN)
    await assertSucceeds(
      updateDoc(doc(store, 'organization_memberships', membershipId(ORG_A, MEMBER)), {
        is_active: false,
        updated_at: serverTimestamp(),
      }),
    )
    await assertFails(
      updateDoc(doc(store, 'organizations', ORG_A), {
        admin_uid: MEMBER,
        updated_at: serverTimestamp(),
      }),
    )
  })

  it('39. rejects a transfer to a member of a different organization', async () => {
    const store = db(ADMIN)
    await assertFails(
      updateDoc(doc(store, 'organizations', ORG_A), {
        admin_uid: OUTSIDER,
        updated_at: serverTimestamp(),
      }),
    )
  })

  it('40. rejects changing admin_uid together with the name', async () => {
    const store = db(ADMIN)
    await assertFails(
      updateDoc(doc(store, 'organizations', ORG_A), {
        admin_uid: MEMBER,
        name: 'Renamed While Transferring',
        updated_at: serverTimestamp(),
      }),
    )
  })

  it('41. rejects deleting an organization', async () => {
    const store = db(ADMIN)
    const batch = writeBatch(store)
    batch.delete(doc(store, 'organizations', ORG_A))
    await assertFails(batch.commit())
  })
})
