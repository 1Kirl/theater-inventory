import { doc, getDoc, runTransaction, serverTimestamp, writeBatch } from 'firebase/firestore'
import { getFirebaseAuth, getFirebaseDb } from '@/lib/firebase'
import { COLLECTIONS, joinProofId, membershipId } from '@/domain/organization-ids'
import { generateJoinCode, isValidJoinCode, normalizeJoinCode } from '@/domain/join-code'
import { OrganizationError } from '@/domain/organization-errors'
import {
  EMPTY_PERMISSIONS,
  type OrganizationAdminSettings,
  type OrganizationJoinCode,
} from '@/types/organization'

function requireUid(): string {
  const user = getFirebaseAuth().currentUser
  if (!user) {
    throw new OrganizationError('not-signed-in', 'You are not signed in.')
  }
  return user.uid
}

export interface JoinCodeInspection {
  /** The normalized code, ready to be used as a document ID. */
  code: string
  organizationId: string
  organizationName: string
}

/**
 * Step one of joining: confirm the code and name the organization.
 *
 * A single document get, because queries on this collection are denied. The
 * caller is not a member yet and cannot read the organization document, which
 * is exactly why the code carries a name snapshot.
 *
 * Only the two fields the confirmation screen needs are returned.
 */
export async function inspectJoinCode(rawCode: string): Promise<JoinCodeInspection> {
  requireUid()
  const code = normalizeJoinCode(rawCode)

  if (!isValidJoinCode(code)) {
    throw new OrganizationError('invalid-join-code', 'That organization code is not valid.')
  }

  const snapshot = await getDoc(doc(getFirebaseDb(), COLLECTIONS.joinCodes, code))
  if (!snapshot.exists()) {
    throw new OrganizationError('join-code-not-found', 'That organization code was not found.')
  }

  const joinCode = snapshot.data() as OrganizationJoinCode
  if (!joinCode.active) {
    throw new OrganizationError(
      'join-code-revoked',
      'That organization code is no longer valid. Ask your Admin for the current one.',
    )
  }

  return {
    code,
    organizationId: joinCode.organization_id,
    organizationName: joinCode.organization_name_snapshot,
  }
}

/**
 * Step two: create the membership and its join proof in one atomic batch.
 *
 * The membership starts empty, so the effective role is Unassigned. Security
 * Rules pin those values, so a joining user cannot grant themselves access on
 * the way in, and verify inside the batch that the proof names a real active
 * code for this organization.
 *
 * An existing membership — active or deactivated — is reported rather than
 * reactivated. The deterministic document ID enforces this independently: the
 * create would fail regardless.
 */
export async function joinOrganization(rawCode: string): Promise<{ organizationId: string }> {
  const uid = requireUid()
  const inspection = await inspectJoinCode(rawCode)
  const db = getFirebaseDb()

  const membershipRef = doc(
    db,
    COLLECTIONS.memberships,
    membershipId(inspection.organizationId, uid),
  )

  const existing = await getDoc(membershipRef)
  if (existing.exists()) {
    throw existing.data().is_active === true
      ? new OrganizationError('already-a-member', 'You already belong to this organization.')
      : new OrganizationError(
          'membership-deactivated',
          'Your membership in this organization was deactivated. Ask an Admin to restore it.',
        )
  }

  const batch = writeBatch(db)

  batch.set(membershipRef, {
    organization_id: inspection.organizationId,
    uid,
    team_ids: [],
    permissions: EMPTY_PERMISSIONS,
    is_active: true,
    joined_at: serverTimestamp(),
    updated_at: serverTimestamp(),
  })

  batch.set(
    doc(db, COLLECTIONS.joinProofs, joinProofId(inspection.organizationId, uid)),
    {
      organization_id: inspection.organizationId,
      uid,
      join_code_id: inspection.code,
      created_at: serverTimestamp(),
    },
  )

  await batch.commit()

  return { organizationId: inspection.organizationId }
}

export async function getCurrentJoinCode(organizationId: string): Promise<string | null> {
  const snapshot = await getDoc(doc(getFirebaseDb(), COLLECTIONS.adminSettings, organizationId))
  if (!snapshot.exists()) return null
  return (snapshot.data() as OrganizationAdminSettings).current_join_code_id
}

/**
 * Issue a new join code and revoke the current one, atomically.
 *
 * The old document is kept with `active: false` and a `revoked_at` stamp, so a
 * superseded code fails validation for a clear reason instead of looking like a
 * typo. Admin only, enforced by Security Rules.
 */
export async function regenerateJoinCode(organizationId: string): Promise<{ joinCode: string }> {
  requireUid()
  const db = getFirebaseDb()
  const newCode = generateJoinCode()

  await runTransaction(db, async (transaction) => {
    const settingsRef = doc(db, COLLECTIONS.adminSettings, organizationId)
    const organizationRef = doc(db, COLLECTIONS.organizations, organizationId)

    const settingsSnapshot = await transaction.get(settingsRef)
    if (!settingsSnapshot.exists()) {
      throw new OrganizationError('admin-settings-not-found', 'Organization settings are missing.')
    }

    const organizationSnapshot = await transaction.get(organizationRef)
    if (!organizationSnapshot.exists()) {
      throw new OrganizationError('organization-not-found', 'Organization not found.')
    }

    const settings = settingsSnapshot.data() as OrganizationAdminSettings
    const organizationName = organizationSnapshot.data().name as string

    transaction.set(doc(db, COLLECTIONS.joinCodes, newCode), {
      organization_id: organizationId,
      organization_name_snapshot: organizationName,
      active: true,
      created_by_uid: requireUid(),
      created_at: serverTimestamp(),
    })

    transaction.update(doc(db, COLLECTIONS.joinCodes, settings.current_join_code_id), {
      active: false,
      revoked_at: serverTimestamp(),
    })

    transaction.update(settingsRef, {
      current_join_code_id: newCode,
      updated_at: serverTimestamp(),
    })
  })

  return { joinCode: newCode }
}
