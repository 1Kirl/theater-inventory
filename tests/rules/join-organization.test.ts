import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest'
import { doc, setDoc, writeBatch, type Firestore } from 'firebase/firestore'
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing'
import {
  ADMIN,
  CODE_A,
  CODE_B,
  MEMBER,
  ORG_A,
  ORG_B,
  OUTSIDER,
  SOME_PERMISSIONS,
  assertFails,
  assertSucceeds,
  createTestEnvironment,
  membershipId,
  newJoinProof,
  newMembership,
  seedOrganization,
} from './helpers'

let environment: RulesTestEnvironment

beforeAll(async () => {
  environment = await createTestEnvironment()
})
afterAll(async () => environment.cleanup())

beforeEach(async () => {
  await environment.clearFirestore()
  await seedOrganization(environment, { organizationId: ORG_A, adminUid: ADMIN, code: CODE_A })
  await seedOrganization(environment, { organizationId: ORG_B, adminUid: OUTSIDER, code: CODE_B })
})

function db(uid: string | null): Firestore {
  const context = uid ? environment.authenticatedContext(uid) : environment.unauthenticatedContext()
  return context.firestore() as unknown as Firestore
}

function joinBatch(store: Firestore, uid: string, organizationId: string, code: string) {
  const batch = writeBatch(store)
  batch.set(
    doc(store, 'organization_memberships', membershipId(organizationId, uid)),
    newMembership(organizationId, uid),
  )
  batch.set(
    doc(store, 'organization_membership_join_proofs', membershipId(organizationId, uid)),
    newJoinProof(organizationId, uid, code),
  )
  return batch
}

async function revokeCode(code: string) {
  await environment.withSecurityRulesDisabled(async (context) => {
    const store = context.firestore() as unknown as Firestore
    await setDoc(doc(store, 'organization_join_codes', code), { active: false }, { merge: true })
  })
}

describe('join organization', () => {
  it('14. accepts a membership and proof created together with an active code', async () => {
    await assertSucceeds(joinBatch(db(MEMBER), MEMBER, ORG_A, CODE_A).commit())
  })

  it('15. rejects an unauthenticated join', async () => {
    await assertFails(joinBatch(db(null), MEMBER, ORG_A, CODE_A).commit())
  })

  it('16. rejects an invalid code that does not exist', async () => {
    await assertFails(joinBatch(db(MEMBER), MEMBER, ORG_A, 'ZZZZZZZZZZZZZZZZ').commit())
  })

  it('17. rejects a revoked code', async () => {
    await revokeCode(CODE_A)
    await assertFails(joinBatch(db(MEMBER), MEMBER, ORG_A, CODE_A).commit())
  })

  it('18. rejects a code belonging to a different organization', async () => {
    await assertFails(joinBatch(db(MEMBER), MEMBER, ORG_A, CODE_B).commit())
  })

  it('19. rejects a membership created without a proof in the same batch', async () => {
    const store = db(MEMBER)
    await assertFails(
      setDoc(
        doc(store, 'organization_memberships', membershipId(ORG_A, MEMBER)),
        newMembership(ORG_A, MEMBER),
      ),
    )
  })

  it('20. rejects a proof created without its membership', async () => {
    const store = db(MEMBER)
    await assertFails(
      setDoc(
        doc(store, 'organization_membership_join_proofs', membershipId(ORG_A, MEMBER)),
        newJoinProof(ORG_A, MEMBER, CODE_A),
      ),
    )
  })

  it('21. rejects a forged proof naming another user', async () => {
    const store = db(MEMBER)
    const batch = writeBatch(store)
    batch.set(
      doc(store, 'organization_memberships', membershipId(ORG_A, MEMBER)),
      newMembership(ORG_A, MEMBER),
    )
    batch.set(doc(store, 'organization_membership_join_proofs', membershipId(ORG_A, MEMBER)), {
      ...newJoinProof(ORG_A, MEMBER, CODE_A),
      uid: OUTSIDER,
    })
    await assertFails(batch.commit())
  })

  it('22. rejects a join that grants itself teams or permissions', async () => {
    const store = db(MEMBER)
    const batch = writeBatch(store)
    batch.set(doc(store, 'organization_memberships', membershipId(ORG_A, MEMBER)), {
      ...newMembership(ORG_A, MEMBER),
      team_ids: ['team-lighting'],
      permissions: SOME_PERMISSIONS,
    })
    batch.set(
      doc(store, 'organization_membership_join_proofs', membershipId(ORG_A, MEMBER)),
      newJoinProof(ORG_A, MEMBER, CODE_A),
    )
    await assertFails(batch.commit())
  })

  it('23. rejects a membership created for somebody else', async () => {
    const store = db(MEMBER)
    const batch = writeBatch(store)
    batch.set(
      doc(store, 'organization_memberships', membershipId(ORG_A, OUTSIDER)),
      newMembership(ORG_A, OUTSIDER),
    )
    batch.set(
      doc(store, 'organization_membership_join_proofs', membershipId(ORG_A, OUTSIDER)),
      newJoinProof(ORG_A, OUTSIDER, CODE_A),
    )
    await assertFails(batch.commit())
  })

  it('24. rejects a duplicate membership for an existing active member', async () => {
    await assertSucceeds(joinBatch(db(MEMBER), MEMBER, ORG_A, CODE_A).commit())
    await assertFails(joinBatch(db(MEMBER), MEMBER, ORG_A, CODE_A).commit())
  })

  it('25. rejects re-joining after deactivation', async () => {
    await environment.withSecurityRulesDisabled(async (context) => {
      const store = context.firestore() as unknown as Firestore
      await setDoc(doc(store, 'organization_memberships', membershipId(ORG_A, MEMBER)), {
        ...newMembership(ORG_A, MEMBER),
        is_active: false,
      })
    })

    await assertFails(joinBatch(db(MEMBER), MEMBER, ORG_A, CODE_A).commit())
  })

  it('26. rejects a proof whose code field is not a valid code shape', async () => {
    const store = db(MEMBER)
    const batch = writeBatch(store)
    batch.set(
      doc(store, 'organization_memberships', membershipId(ORG_A, MEMBER)),
      newMembership(ORG_A, MEMBER),
    )
    batch.set(doc(store, 'organization_membership_join_proofs', membershipId(ORG_A, MEMBER)), {
      ...newJoinProof(ORG_A, MEMBER, CODE_A),
      join_code_id: '../organizations/x',
    })
    await assertFails(batch.commit())
  })
})
