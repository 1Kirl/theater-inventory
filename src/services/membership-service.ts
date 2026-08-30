import {
  collection, deleteField, doc, getDoc, getDocs, query, serverTimestamp, updateDoc, where,
} from 'firebase/firestore'
import { getFirebaseAuth, getFirebaseDb } from '@/lib/firebase'
import { COLLECTIONS, membershipId } from '@/domain/organization-ids'
import { OrganizationError } from '@/domain/organization-errors'
import { PROFILE_FIELD_KEYS, profileFields, type MemberProfileInput } from '@/domain/member-profile'
import type { ModulePermissions, OrganizationMembership } from '@/types/organization'

function requireUid(): string {
  const user = getFirebaseAuth().currentUser
  if (!user) {
    throw new OrganizationError('not-signed-in', 'You are not signed in.')
  }
  return user.uid
}

export async function getMembership(
  organizationId: string,
  uid: string,
): Promise<OrganizationMembership | null> {
  const snapshot = await getDoc(
    doc(getFirebaseDb(), COLLECTIONS.memberships, membershipId(organizationId, uid)),
  )
  return snapshot.exists() ? (snapshot.data() as OrganizationMembership) : null
}

/**
 * Memberships for the signed-in user, for Organization Selection.
 *
 * Security Rules admit this through the self clause, which reads only the
 * candidate document and costs no document access call.
 */
export async function listMyActiveMemberships(): Promise<OrganizationMembership[]> {
  const uid = requireUid()
  const snapshot = await getDocs(
    query(
      collection(getFirebaseDb(), COLLECTIONS.memberships),
      where('uid', '==', uid),
      where('is_active', '==', true),
    ),
  )
  return snapshot.docs.map((entry) => entry.data() as OrganizationMembership)
}

/**
 * The member directory for one organization.
 *
 * Rules are not filters. Both constraints are mandatory for a non-Admin: drop
 * `is_active` and deactivated documents become candidates that fail the rule,
 * which rejects the whole query rather than trimming the result.
 *
 * `includeInactive` is for Admins only. A non-Admin issuing it is denied.
 */
export async function listOrganizationDirectory(
  organizationId: string,
  options: { includeInactive?: boolean } = {},
): Promise<OrganizationMembership[]> {
  const constraints = [where('organization_id', '==', organizationId)]
  if (!options.includeInactive) {
    constraints.push(where('is_active', '==', true))
  }

  const snapshot = await getDocs(
    query(collection(getFirebaseDb(), COLLECTIONS.memberships), ...constraints),
  )
  return snapshot.docs.map((entry) => entry.data() as OrganizationMembership)
}

/**
 * Assign teams and module permissions. Admin only, enforced by Security Rules.
 *
 * No role is written. The membership simply starts reading as Member once it
 * holds a team and at least one module at view or edit.
 */
export async function assignMembership(params: {
  organizationId: string
  uid: string
  teamIds: string[]
  permissions: ModulePermissions
}): Promise<void> {
  await updateDoc(
    doc(getFirebaseDb(), COLLECTIONS.memberships, membershipId(params.organizationId, params.uid)),
    {
      team_ids: params.teamIds,
      permissions: params.permissions,
      updated_at: serverTimestamp(),
    },
  )
}

/**
 * Update your own profile in the organization you are currently in.
 *
 * Only the four fields a member owns, and only on their own membership. Teams,
 * permissions, activity, and identity are not in the payload and are refused by
 * Security Rules if they ever appear — the disabled inputs in the dialog are a
 * convenience, not the boundary.
 *
 * A cleared field is deleted rather than written as an empty string, so the
 * document keeps one shape for "nothing here" instead of two. `updateDoc`
 * merges, so nothing outside these keys is touched: an Admin changing somebody's
 * team at the same moment does not lose their phone number, and this does not
 * lose their team.
 */
export async function updateMyOrganizationProfile(params: {
  organizationId: string
  input: MemberProfileInput
}): Promise<void> {
  const uid = requireUid()
  const present = profileFields(params.input)

  const payload: Record<string, unknown> = { updated_at: serverTimestamp() }
  for (const key of PROFILE_FIELD_KEYS) {
    payload[key] = present[key] ?? deleteField()
  }

  await updateDoc(
    doc(getFirebaseDb(), COLLECTIONS.memberships, membershipId(params.organizationId, uid)),
    payload,
  )
}

/**
 * Activate or deactivate a membership. Admin only.
 *
 * Deactivating the current Admin's own membership is rejected by Security
 * Rules; administration must be transferred first, so an organization is never
 * left without an Admin.
 */
export async function setMembershipActive(params: {
  organizationId: string
  uid: string
  isActive: boolean
}): Promise<void> {
  await updateDoc(
    doc(getFirebaseDb(), COLLECTIONS.memberships, membershipId(params.organizationId, params.uid)),
    {
      is_active: params.isActive,
      updated_at: serverTimestamp(),
    },
  )
}
