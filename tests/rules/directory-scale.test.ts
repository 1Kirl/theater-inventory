import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { collection, getDocs, query, where, type Firestore } from 'firebase/firestore'
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing'
import {
  ADMIN,
  CODE_A,
  ORG_A,
  OUTSIDER,
  assertFails,
  assertSucceeds,
  createTestEnvironment,
  seedOrganization,
} from './helpers'

/**
 * Risk R1: the member directory rule calls get() per candidate document.
 *
 * The access-call limit for a query request is 10, so if identical paths were
 * not collapsed the query would start failing somewhere between 5 and 20
 * members. These tests are the evidence that the current implementation does
 * not hit that limit at the sizes covered here.
 *
 * They are evidence, not a guarantee. Firebase documents that some access calls
 * are cached and that cached calls do not count toward the limit, but it does
 * not contract that behaviour across a whole query evaluation, and the emulator
 * is not production Firestore. If real Firestore ever returns permission-denied
 * for this query, the member directory authorization structure is what needs to
 * change — not this rule's strictness.
 */

let environment: RulesTestEnvironment

const SIZES = [1, 5, 10, 20] as const

beforeAll(async () => {
  environment = await createTestEnvironment()
})
afterAll(async () => environment.cleanup())

function db(uid: string): Firestore {
  return environment.authenticatedContext(uid).firestore() as unknown as Firestore
}

function memberUid(index: number): string {
  return `uid-scale-member-${String(index).padStart(3, '0')}`
}

async function seedWithMembers(memberCount: number): Promise<void> {
  await environment.clearFirestore()

  // One deactivated member so the Admin query genuinely returns a document the
  // member-facing rule clause would reject.
  const members = Array.from({ length: memberCount }, (_, index) => ({
    uid: memberUid(index),
    assigned: true,
    isActive: index !== 0 || memberCount === 1,
  }))

  await seedOrganization(environment, {
    organizationId: ORG_A,
    adminUid: ADMIN,
    code: CODE_A,
    members,
  })
}

function directoryQuery(store: Firestore, options: { includeInactive: boolean }) {
  const constraints = [where('organization_id', '==', ORG_A)]
  if (!options.includeInactive) {
    constraints.push(where('is_active', '==', true))
  }
  return query(collection(store, 'organization_memberships'), ...constraints)
}

describe.each(SIZES)('member directory at %i member(s)', (memberCount) => {
  it('a member may query the active directory', async () => {
    await seedWithMembers(memberCount)
    const caller = memberCount === 1 ? memberUid(0) : memberUid(1)

    const snapshot = await assertSucceeds(
      getDocs(directoryQuery(db(caller), { includeInactive: false })),
    )
    expect(snapshot.empty).toBe(false)
  })

  it('an Admin may query the active directory', async () => {
    await seedWithMembers(memberCount)
    const snapshot = await assertSucceeds(
      getDocs(directoryQuery(db(ADMIN), { includeInactive: false })),
    )
    expect(snapshot.empty).toBe(false)
  })

  it('an Admin may include deactivated members', async () => {
    await seedWithMembers(memberCount)
    const snapshot = await assertSucceeds(
      getDocs(directoryQuery(db(ADMIN), { includeInactive: true })),
    )
    // Admin + every seeded member.
    expect(snapshot.size).toBe(memberCount + 1)
  })

  it('a member dropping the is_active filter is rejected, not filtered', async () => {
    await seedWithMembers(memberCount)
    const caller = memberCount === 1 ? memberUid(0) : memberUid(1)

    if (memberCount === 1) return // no deactivated document exists to trip the rule

    await assertFails(getDocs(directoryQuery(db(caller), { includeInactive: true })))
  })

  it('an outsider is rejected at every size', async () => {
    await seedWithMembers(memberCount)
    await assertFails(getDocs(directoryQuery(db(OUTSIDER), { includeInactive: false })))
  })
})
