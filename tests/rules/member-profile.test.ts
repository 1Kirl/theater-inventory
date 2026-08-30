import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  collection, doc, getDoc, getDocs, query, serverTimestamp, updateDoc, where,
  type Firestore,
} from 'firebase/firestore'
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing'
import {
  ADMIN, CODE_A, CODE_B, EDIT_INVENTORY, ORG_A, ORG_B, OUTSIDER, TEAM_LIGHTING, TEAM_OTHER_ORG,
  VIEW_INVENTORY, assertFails, assertSucceeds, createTestEnvironment, membershipId,
  seedMembership, seedOrganization, seedTeam,
} from './helpers'

/**
 * Who may read the directory, and who may write to a membership.
 *
 * Contacts adds four fields to a document that already had an owner problem
 * worth being careful about: the Admin decides what somebody may do, and the
 * member decides how they are reached. Neither should be able to do the other's
 * job, and the interface is not what stops them.
 */

let environment: RulesTestEnvironment

const MEMBER = 'uid-profile-member'
const OTHER_MEMBER = 'uid-profile-other'
const UNASSIGNED = 'uid-profile-unassigned'
const DEACTIVATED = 'uid-profile-deactivated'
const STRANGER = 'uid-profile-stranger'

beforeAll(async () => { environment = await createTestEnvironment() })
afterAll(async () => environment.cleanup())

function db(uid: string | null): Firestore {
  const context = uid ? environment.authenticatedContext(uid) : environment.unauthenticatedContext()
  return context.firestore() as unknown as Firestore
}

function membershipRef(store: Firestore, organizationId: string, uid: string) {
  return doc(store, 'organization_memberships', membershipId(organizationId, uid))
}

/** The payload the profile service sends: four fields and a timestamp. */
function profileUpdate(fields: Record<string, unknown> = {}) {
  return { ...fields, updated_at: serverTimestamp() }
}

beforeEach(async () => {
  await environment.clearFirestore()

  await seedOrganization(environment, { organizationId: ORG_A, adminUid: ADMIN, code: CODE_A })
  await seedOrganization(environment, { organizationId: ORG_B, adminUid: OUTSIDER, code: CODE_B })
  await seedTeam(environment, { teamId: TEAM_LIGHTING, organizationId: ORG_A, name: 'Lighting' })
  await seedTeam(environment, { teamId: TEAM_OTHER_ORG, organizationId: ORG_B, name: 'Sound' })

  await seedMembership(environment, {
    organizationId: ORG_A, uid: ADMIN, teamIds: [TEAM_LIGHTING], permissions: EDIT_INVENTORY,
  })
  await seedMembership(environment, {
    organizationId: ORG_A, uid: MEMBER, teamIds: [TEAM_LIGHTING], permissions: VIEW_INVENTORY,
  })
  await seedMembership(environment, {
    organizationId: ORG_A, uid: OTHER_MEMBER, teamIds: [TEAM_LIGHTING], permissions: VIEW_INVENTORY,
  })
  // Joined with a code, not yet given anything to do.
  await seedMembership(environment, { organizationId: ORG_A, uid: UNASSIGNED })
  await seedMembership(environment, {
    organizationId: ORG_A, uid: DEACTIVATED, teamIds: [TEAM_LIGHTING],
    permissions: VIEW_INVENTORY, isActive: false,
  })
  await seedMembership(environment, {
    organizationId: ORG_B, uid: OUTSIDER, teamIds: [TEAM_OTHER_ORG], permissions: VIEW_INVENTORY,
  })
})

describe('reading the directory', () => {
  function directory(uid: string | null, organizationId: string) {
    return getDocs(query(
      collection(db(uid), 'organization_memberships'),
      where('organization_id', '==', organizationId),
      where('is_active', '==', true),
    ))
  }

  it('opens for the Admin', async () => {
    await assertSucceeds(directory(ADMIN, ORG_A))
  })

  it('opens for an assigned member', async () => {
    await assertSucceeds(directory(MEMBER, ORG_A))
  })

  it('stays shut for somebody in another organization', async () => {
    await assertSucceeds(directory(OUTSIDER, ORG_B))
    await assertFails(directory(OUTSIDER, ORG_A))
  })

  it('stays shut for a signed-out visitor', async () => {
    await assertFails(directory(null, ORG_A))
  })

  it('stays shut for somebody in no organization at all', async () => {
    await assertFails(directory(STRANGER, ORG_A))
  })

  it('opens for somebody who joined but has not been assigned yet', async () => {
    // Recorded deliberately rather than assumed: `isActiveMemberOf` has always
    // asked only whether the membership is active, so this was already true of
    // every other membership field before contacts existed.
    await assertSucceeds(directory(UNASSIGNED, ORG_A))
  })
})

describe('what an unassigned member gains, and what they do not', () => {
  it('may edit their own profile while they wait', async () => {
    // They joined with a code and are waiting to be assigned. Saying how to
    // reach them is the one useful thing they can do meanwhile.
    await assertSucceeds(updateDoc(
      membershipRef(db(UNASSIGNED), ORG_A, UNASSIGNED),
      profileUpdate({
        profile_display_name: 'New Volunteer',
        profile_contact_email: 'volunteer@school.edu',
      }),
    ))
  })

  it('still cannot give themselves a team or a permission', async () => {
    // The directory is not a foothold. This is the whole reason the exception
    // is safe to make.
    await assertFails(updateDoc(
      membershipRef(db(UNASSIGNED), ORG_A, UNASSIGNED),
      profileUpdate({ team_ids: [TEAM_LIGHTING] }),
    ))
    await assertFails(updateDoc(
      membershipRef(db(UNASSIGNED), ORG_A, UNASSIGNED),
      profileUpdate({
        permissions: {
          inventory: 'edit', maintenance: 'edit', productions: 'edit', calendar: 'edit',
        },
      }),
    ))
  })

  it('still cannot read a single module they were never given', async () => {
    const store = db(UNASSIGNED)

    await assertFails(getDocs(query(
      collection(store, 'inventory_items'), where('organization_id', '==', ORG_A),
    )))
    await assertFails(getDocs(query(
      collection(store, 'maintenance_records'), where('organization_id', '==', ORG_A),
    )))
    await assertFails(getDocs(query(
      collection(store, 'productions'), where('organization_id', '==', ORG_A),
    )))
    await assertFails(getDocs(query(
      collection(store, 'calendar_events'), where('organization_id', '==', ORG_A),
    )))
  })

  it('still cannot read another organization’s directory', async () => {
    await assertFails(getDocs(query(
      collection(db(UNASSIGNED), 'organization_memberships'),
      where('organization_id', '==', ORG_B),
      where('is_active', '==', true),
    )))
  })

  it('loses the directory the moment their membership is deactivated', async () => {
    await environment.withSecurityRulesDisabled(async (context) => {
      const store = context.firestore() as unknown as Firestore
      await updateDoc(membershipRef(store, ORG_A, UNASSIGNED), { is_active: false })
    })

    await assertFails(getDocs(query(
      collection(db(UNASSIGNED), 'organization_memberships'),
      where('organization_id', '==', ORG_A),
      where('is_active', '==', true),
    )))
  })
})

describe('editing your own profile', () => {
  it('accepts the four fields a member owns', async () => {
    await assertSucceeds(updateDoc(
      membershipRef(db(MEMBER), ORG_A, MEMBER),
      profileUpdate({
        profile_display_name: 'Jina Kim',
        profile_phone: '010-1234-5678',
        profile_contact_email: 'jina@school.edu',
        profile_bio: 'Sound crew and wireless microphones.',
      }),
    ))
  })

  it('accepts a profile with nothing in it', async () => {
    await assertSucceeds(updateDoc(
      membershipRef(db(MEMBER), ORG_A, MEMBER), profileUpdate(),
    ))
  })

  it('accepts the Admin editing their own, because they are a member too', async () => {
    await assertSucceeds(updateDoc(
      membershipRef(db(ADMIN), ORG_A, ADMIN),
      profileUpdate({ profile_display_name: 'The Director' }),
    ))
  })

  it('refuses somebody else', async () => {
    await assertFails(updateDoc(
      membershipRef(db(MEMBER), ORG_A, OTHER_MEMBER),
      profileUpdate({ profile_phone: '010-0000-0000' }),
    ))
  })

  it('refuses the Admin editing a member’s personal details', async () => {
    // Administration decides what somebody may do, not how they are reached.
    await assertFails(updateDoc(
      membershipRef(db(ADMIN), ORG_A, MEMBER),
      profileUpdate({ profile_phone: '010-0000-0000' }),
    ))
  })

  it('refuses a member whose membership was deactivated', async () => {
    await assertFails(updateDoc(
      membershipRef(db(DEACTIVATED), ORG_A, DEACTIVATED),
      profileUpdate({ profile_display_name: 'Still here' }),
    ))
  })
})

describe('what a member cannot reach through their own profile', () => {
  it.each([
    ['a team', { team_ids: [TEAM_LIGHTING, 'team-anything'] }],
    ['a permission', {
      permissions: {
        inventory: 'edit', maintenance: 'edit', productions: 'edit', calendar: 'edit',
      },
    }],
    ['their organization', { organization_id: ORG_B }],
    ['their identity', { uid: OTHER_MEMBER }],
    ['their own activity', { is_active: false }],
    ['an unknown field', { admin: true }],
  ])('refuses %s', async (_label, fields) => {
    // Each of these is somebody else's decision. The dialog never offers them,
    // and that is not why they fail.
    await assertFails(updateDoc(
      membershipRef(db(MEMBER), ORG_A, MEMBER), profileUpdate(fields),
    ))
  })

  it('refuses a profile field smuggled alongside a team change', async () => {
    await assertFails(updateDoc(
      membershipRef(db(MEMBER), ORG_A, MEMBER),
      profileUpdate({ profile_display_name: 'Jina', team_ids: [TEAM_LIGHTING, 'team-x'] }),
    ))
  })
})

describe('what a profile field may contain', () => {
  const write = (fields: Record<string, unknown>) => updateDoc(
    membershipRef(db(MEMBER), ORG_A, MEMBER), profileUpdate(fields),
  )

  it.each([
    ['a name that is too long', { profile_display_name: 'a'.repeat(61) }],
    ['a phone that is too long', { profile_phone: '0'.repeat(41) }],
    ['an email that is too long', { profile_contact_email: `${'a'.repeat(250)}@b.co` }],
    ['a biography that is too long', { profile_bio: 'a'.repeat(301) }],
    ['a number instead of text', { profile_phone: 1012345678 }],
    ['an empty string instead of an absent field', { profile_display_name: '' }],
    ['markup in a biography', { profile_bio: 'I do <script>alert(1)</script>' }],
    ['markup in a name', { profile_display_name: '<b>Jina</b>' }],
  ])('refuses %s', async (_label, fields) => {
    await assertFails(write(fields))
  })

  it('accepts text right at the limit', async () => {
    await assertSucceeds(write({ profile_bio: 'a'.repeat(300) }))
  })
})

describe('the two owners do not overwrite each other', () => {
  it('leaves a member’s profile alone when the Admin changes their team', async () => {
    // `updateDoc` merges, so the Admin's payload never mentions these fields.
    // This is the regression that would matter if it ever became a whole
    // document write.
    await assertSucceeds(updateDoc(
      membershipRef(db(MEMBER), ORG_A, MEMBER),
      profileUpdate({ profile_phone: '010-1234-5678', profile_bio: 'Sound crew.' }),
    ))

    await assertSucceeds(updateDoc(
      membershipRef(db(ADMIN), ORG_A, MEMBER),
      {
        team_ids: [TEAM_LIGHTING],
        permissions: {
          inventory: 'edit', maintenance: 'none', productions: 'none', calendar: 'none',
        },
        updated_at: serverTimestamp(),
      },
    ))

    let stored: Record<string, unknown> = {}
    await environment.withSecurityRulesDisabled(async (context) => {
      const store = context.firestore() as unknown as Firestore
      const snapshot = await getDoc(membershipRef(store, ORG_A, MEMBER))
      stored = snapshot.data() as Record<string, unknown>
    })

    expect(stored.profile_phone).toBe('010-1234-5678')
    expect(stored.profile_bio).toBe('Sound crew.')
    expect(stored.permissions).toMatchObject({ inventory: 'edit' })
  })

  it('leaves a member’s team alone when they edit their profile', async () => {
    await assertSucceeds(updateDoc(
      membershipRef(db(MEMBER), ORG_A, MEMBER),
      profileUpdate({ profile_display_name: 'Jina Kim' }),
    ))

    let stored: Record<string, unknown> = {}
    await environment.withSecurityRulesDisabled(async (context) => {
      const store = context.firestore() as unknown as Firestore
      const snapshot = await getDoc(membershipRef(store, ORG_A, MEMBER))
      stored = snapshot.data() as Record<string, unknown>
    })

    expect(stored.team_ids).toEqual([TEAM_LIGHTING])
    expect(stored.profile_display_name).toBe('Jina Kim')
  })

  it('still lets the Admin deactivate a member who has a profile', async () => {
    await assertSucceeds(updateDoc(
      membershipRef(db(MEMBER), ORG_A, MEMBER),
      profileUpdate({ profile_phone: '010-1234-5678' }),
    ))

    await assertSucceeds(updateDoc(
      membershipRef(db(ADMIN), ORG_A, MEMBER),
      { is_active: false, updated_at: serverTimestamp() },
    ))
  })
})

describe('memberships written before profiles existed', () => {
  it('are still readable and still writable by their owner', async () => {
    // Nothing was migrated. A membership with none of these fields is valid,
    // and adding one is an ordinary update.
    let stored: Record<string, unknown> = {}
    await environment.withSecurityRulesDisabled(async (context) => {
      const store = context.firestore() as unknown as Firestore
      const snapshot = await getDoc(membershipRef(store, ORG_A, MEMBER))
      stored = snapshot.data() as Record<string, unknown>
    })

    expect('profile_display_name' in stored).toBe(false)
    await assertSucceeds(getDoc(membershipRef(db(MEMBER), ORG_A, MEMBER)))
    await assertSucceeds(updateDoc(
      membershipRef(db(MEMBER), ORG_A, MEMBER),
      profileUpdate({ profile_display_name: 'Jina Kim' }),
    ))
  })

  it('still accept the Admin assignment they always did', async () => {
    await assertSucceeds(updateDoc(
      membershipRef(db(ADMIN), ORG_A, UNASSIGNED),
      {
        team_ids: [TEAM_LIGHTING],
        permissions: {
          inventory: 'view', maintenance: 'none', productions: 'none', calendar: 'none',
        },
        updated_at: serverTimestamp(),
      },
    ))
  })
})
