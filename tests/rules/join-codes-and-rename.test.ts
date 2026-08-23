import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest'
import { doc, serverTimestamp, updateDoc, writeBatch, type Firestore } from 'firebase/firestore'
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing'
import {
  ADMIN,
  CODE_A,
  CODE_A2,
  CODE_B,
  MEMBER,
  ORG_A,
  ORG_B,
  OUTSIDER,
  assertFails,
  assertSucceeds,
  createTestEnvironment,
  newJoinCode,
  seedOrganization,
} from './helpers'

let environment: RulesTestEnvironment
const ORIGINAL_NAME = 'Riverside Theater'
const NEW_NAME = 'Riverside Playhouse'

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
    name: ORIGINAL_NAME,
    members: [{ uid: MEMBER, assigned: true }],
  })
  await seedOrganization(environment, { organizationId: ORG_B, adminUid: OUTSIDER, code: CODE_B })
})

function db(uid: string | null): Firestore {
  const context = uid ? environment.authenticatedContext(uid) : environment.unauthenticatedContext()
  return context.firestore() as unknown as Firestore
}

function regenerateBatch(store: Firestore, uid: string) {
  const batch = writeBatch(store)
  batch.set(doc(store, 'organization_join_codes', CODE_A2), newJoinCode(ORG_A, uid, ORIGINAL_NAME))
  batch.update(doc(store, 'organization_join_codes', CODE_A), {
    active: false,
    revoked_at: serverTimestamp(),
  })
  batch.update(doc(store, 'organization_admin_settings', ORG_A), {
    current_join_code_id: CODE_A2,
    updated_at: serverTimestamp(),
  })
  return batch
}

describe('join code regeneration', () => {
  it('42. lets the Admin issue a new code and revoke the old one', async () => {
    await assertSucceeds(regenerateBatch(db(ADMIN), ADMIN).commit())
  })

  it('43. rejects regeneration by an ordinary member', async () => {
    await assertFails(regenerateBatch(db(MEMBER), MEMBER).commit())
  })

  it('44. rejects regeneration by an Admin of a different organization', async () => {
    await assertFails(regenerateBatch(db(OUTSIDER), OUTSIDER).commit())
  })

  it('45. rejects repointing admin settings at a code that is not created or active', async () => {
    const store = db(ADMIN)
    await assertFails(
      updateDoc(doc(store, 'organization_admin_settings', ORG_A), {
        current_join_code_id: 'ZZZZZZZZZZZZZZZZ',
        updated_at: serverTimestamp(),
      }),
    )
  })

  it('46. rejects repointing admin settings at another organization code', async () => {
    const store = db(ADMIN)
    await assertFails(
      updateDoc(doc(store, 'organization_admin_settings', ORG_A), {
        current_join_code_id: CODE_B,
        updated_at: serverTimestamp(),
      }),
    )
  })

  it('47. rejects reactivating a revoked code', async () => {
    await assertSucceeds(regenerateBatch(db(ADMIN), ADMIN).commit())
    const store = db(ADMIN)
    await assertFails(
      updateDoc(doc(store, 'organization_join_codes', CODE_A), {
        active: true,
      }),
    )
  })

  it('48. rejects deleting a join code', async () => {
    const store = db(ADMIN)
    const batch = writeBatch(store)
    batch.delete(doc(store, 'organization_join_codes', CODE_A))
    await assertFails(batch.commit())
  })

  it('49. lets any signed-in user get a code they hold', async () => {
    const store = db(OUTSIDER)
    await assertSucceeds(
      import('firebase/firestore').then(({ getDoc }) =>
        getDoc(doc(store, 'organization_join_codes', CODE_A)),
      ),
    )
  })

  it('50. rejects an unauthenticated code read', async () => {
    const store = db(null)
    await assertFails(
      import('firebase/firestore').then(({ getDoc }) =>
        getDoc(doc(store, 'organization_join_codes', CODE_A)),
      ),
    )
  })
})

describe('organization rename', () => {
  function renameBatch(store: Firestore, organizationName: string, snapshotName: string) {
    const batch = writeBatch(store)
    batch.update(doc(store, 'organizations', ORG_A), {
      name: organizationName,
      updated_at: serverTimestamp(),
    })
    batch.update(doc(store, 'organization_join_codes', CODE_A), {
      organization_name_snapshot: snapshotName,
    })
    return batch
  }

  it('51. accepts a rename that carries the active code snapshot with it', async () => {
    await assertSucceeds(renameBatch(db(ADMIN), NEW_NAME, NEW_NAME).commit())
  })

  it('52. rejects renaming the organization alone', async () => {
    const store = db(ADMIN)
    await assertFails(
      updateDoc(doc(store, 'organizations', ORG_A), {
        name: NEW_NAME,
        updated_at: serverTimestamp(),
      }),
    )
  })

  it('53. rejects a rename whose snapshot disagrees with the new name', async () => {
    await assertFails(renameBatch(db(ADMIN), NEW_NAME, 'Something Else').commit())
  })

  it('54. rejects updating the snapshot alone', async () => {
    const store = db(ADMIN)
    await assertFails(
      updateDoc(doc(store, 'organization_join_codes', CODE_A), {
        organization_name_snapshot: NEW_NAME,
      }),
    )
  })

  it('55. rejects a rename by an ordinary member', async () => {
    await assertFails(renameBatch(db(MEMBER), NEW_NAME, NEW_NAME).commit())
  })

  it('56. rejects an empty name', async () => {
    await assertFails(renameBatch(db(ADMIN), '', '').commit())
  })
})
