import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { doc, getDoc, serverTimestamp, writeBatch, type Firestore } from 'firebase/firestore'
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing'
import {
  buildAdminSettingsDocument,
  buildJoinCodeDocument,
  buildJoinProofDocument,
  buildMembershipDocument,
  buildOrganizationDocument,
  buildTeamDocument,
} from '@/domain/organization-payloads'
import {
  ADMIN,
  CODE_A,
  MEMBER,
  ORG_A,
  assertFails,
  assertSucceeds,
  createTestEnvironment,
  membershipId,
  seedOrganization,
} from './helpers'

/**
 * These tests use the same payload builders the application ships, so a change
 * to a document shape is caught here instead of in production. Fixtures written
 * by hand cannot do that: they can keep passing while the real service drifts
 * away from what Rules accept.
 */

let environment: RulesTestEnvironment

beforeAll(async () => {
  environment = await createTestEnvironment()
})
afterAll(async () => environment.cleanup())
beforeEach(async () => environment.clearFirestore())

function db(uid: string): Firestore {
  return environment.authenticatedContext(uid).firestore() as unknown as Firestore
}

describe('create organization, exactly as the service builds it', () => {
  it('115. commits the four documents the service writes', async () => {
    const store = db(ADMIN)
    const batch = writeBatch(store)

    batch.set(
      doc(store, 'organizations', ORG_A),
      buildOrganizationDocument({
        organizationId: ORG_A,
        name: 'Riverside Theater',
        uid: ADMIN,
        now: serverTimestamp,
      }),
    )
    batch.set(
      doc(store, 'organization_memberships', membershipId(ORG_A, ADMIN)),
      buildMembershipDocument({ organizationId: ORG_A, uid: ADMIN, now: serverTimestamp }),
    )
    batch.set(
      doc(store, 'organization_join_codes', CODE_A),
      buildJoinCodeDocument({
        organizationId: ORG_A,
        organizationName: 'Riverside Theater',
        uid: ADMIN,
        now: serverTimestamp,
      }),
    )
    batch.set(
      doc(store, 'organization_admin_settings', ORG_A),
      buildAdminSettingsDocument({ organizationId: ORG_A, joinCode: CODE_A, now: serverTimestamp }),
    )

    await assertSucceeds(batch.commit())
  })

  it('116. commits with the optional description the form may supply', async () => {
    const store = db(ADMIN)
    const batch = writeBatch(store)

    batch.set(
      doc(store, 'organizations', ORG_A),
      buildOrganizationDocument({
        organizationId: ORG_A,
        name: 'Riverside Theater',
        description: '  High school theater department  ',
        uid: ADMIN,
        now: serverTimestamp,
      }),
    )
    batch.set(
      doc(store, 'organization_memberships', membershipId(ORG_A, ADMIN)),
      buildMembershipDocument({ organizationId: ORG_A, uid: ADMIN, now: serverTimestamp }),
    )
    batch.set(
      doc(store, 'organization_join_codes', CODE_A),
      buildJoinCodeDocument({
        organizationId: ORG_A,
        organizationName: 'Riverside Theater',
        uid: ADMIN,
        now: serverTimestamp,
      }),
    )
    batch.set(
      doc(store, 'organization_admin_settings', ORG_A),
      buildAdminSettingsDocument({ organizationId: ORG_A, joinCode: CODE_A, now: serverTimestamp }),
    )

    await assertSucceeds(batch.commit())
  })
})

describe('join organization, exactly as the service performs it', () => {
  beforeEach(async () => {
    await seedOrganization(environment, { organizationId: ORG_A, adminUid: ADMIN, code: CODE_A })
  })

  /**
   * The regression this suite exists for. The service reads its own membership
   * before joining, to tell "already a member" apart from "deactivated". For a
   * first-time joiner that document does not exist, `resource` is null in the
   * rule, and the read is refused rather than returning empty.
   */
  it('117. refuses the pre-flight read of a membership that does not exist yet', async () => {
    const store = db(MEMBER)
    await assertFails(getDoc(doc(store, 'organization_memberships', membershipId(ORG_A, MEMBER))))
  })

  it('118. completes the whole join sequence the service performs', async () => {
    const store = db(MEMBER)
    const membershipRef = doc(store, 'organization_memberships', membershipId(ORG_A, MEMBER))

    // Step one: the pre-flight read, tolerated exactly as the service does.
    const existing = await getDoc(membershipRef).then(
      (snapshot) => (snapshot.exists() ? snapshot.data() : null),
      () => null,
    )
    expect(existing).toBeNull()

    // Step two: the atomic batch.
    const batch = writeBatch(store)
    batch.set(
      membershipRef,
      buildMembershipDocument({ organizationId: ORG_A, uid: MEMBER, now: serverTimestamp }),
    )
    batch.set(
      doc(store, 'organization_membership_join_proofs', membershipId(ORG_A, MEMBER)),
      buildJoinProofDocument({
        organizationId: ORG_A,
        uid: MEMBER,
        joinCode: CODE_A,
        now: serverTimestamp,
      }),
    )

    await assertSucceeds(batch.commit())
  })

  it('119. lets the joiner read their membership once it exists', async () => {
    const store = db(MEMBER)
    const membershipRef = doc(store, 'organization_memberships', membershipId(ORG_A, MEMBER))

    const batch = writeBatch(store)
    batch.set(
      membershipRef,
      buildMembershipDocument({ organizationId: ORG_A, uid: MEMBER, now: serverTimestamp }),
    )
    batch.set(
      doc(store, 'organization_membership_join_proofs', membershipId(ORG_A, MEMBER)),
      buildJoinProofDocument({
        organizationId: ORG_A,
        uid: MEMBER,
        joinCode: CODE_A,
        now: serverTimestamp,
      }),
    )
    await batch.commit()

    // This is what makes tolerating the refused read safe: once the membership
    // exists, the self clause admits the read and the service can report
    // "already a member" precisely.
    const snapshot = await assertSucceeds(getDoc(membershipRef))
    expect(snapshot.exists()).toBe(true)
    expect(snapshot.data()?.is_active).toBe(true)
  })

  it('120. still refuses a second join for the same member', async () => {
    const store = db(MEMBER)
    const membershipRef = doc(store, 'organization_memberships', membershipId(ORG_A, MEMBER))

    for (const attempt of [1, 2]) {
      const batch = writeBatch(store)
      batch.set(
        membershipRef,
        buildMembershipDocument({ organizationId: ORG_A, uid: MEMBER, now: serverTimestamp }),
      )
      batch.set(
        doc(store, 'organization_membership_join_proofs', membershipId(ORG_A, MEMBER)),
        buildJoinProofDocument({
          organizationId: ORG_A,
          uid: MEMBER,
          joinCode: CODE_A,
          now: serverTimestamp,
        }),
      )

      if (attempt === 1) {
        await assertSucceeds(batch.commit())
      } else {
        await assertFails(batch.commit())
      }
    }
  })
})

describe('team creation, exactly as the service builds it', () => {
  beforeEach(async () => {
    await seedOrganization(environment, { organizationId: ORG_A, adminUid: ADMIN, code: CODE_A })
  })

  it('121. commits the team document the service writes', async () => {
    const store = db(ADMIN)
    const teamId = 'teamSERVICEPAYLOAD01'

    await assertSucceeds(
      import('firebase/firestore').then(({ setDoc }) =>
        setDoc(
          doc(store, 'teams', teamId),
          buildTeamDocument({
            teamId,
            organizationId: ORG_A,
            name: 'Lighting',
            now: serverTimestamp,
          }),
        ),
      ),
    )
  })

  it('122. commits a team with the optional description', async () => {
    const store = db(ADMIN)
    const teamId = 'teamSERVICEPAYLOAD02'

    await assertSucceeds(
      import('firebase/firestore').then(({ setDoc }) =>
        setDoc(
          doc(store, 'teams', teamId),
          buildTeamDocument({
            teamId,
            organizationId: ORG_A,
            name: 'Sound',
            description: '  Audio and comms  ',
            now: serverTimestamp,
          }),
        ),
      ),
    )
  })
})
