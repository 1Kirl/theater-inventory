import {
  collection,
  doc,
  getDoc,
  runTransaction,
  serverTimestamp,
  writeBatch,
} from 'firebase/firestore'
import { getFirebaseAuth, getFirebaseDb } from '@/lib/firebase'
import { COLLECTIONS, membershipId } from '@/domain/organization-ids'
import { generateJoinCode } from '@/domain/join-code'
import { OrganizationError } from '@/domain/organization-errors'
import {
  buildAdminSettingsDocument,
  buildJoinCodeDocument,
  buildMembershipDocument,
  buildOrganizationDocument,
} from '@/domain/organization-payloads'
import type { Organization } from '@/types/organization'

const MAX_ORGANIZATION_NAME_LENGTH = 100

function requireUid(): string {
  const user = getFirebaseAuth().currentUser
  if (!user) {
    throw new OrganizationError('not-signed-in', 'You are not signed in.')
  }
  return user.uid
}

function requireName(rawName: string): string {
  const name = rawName.trim()
  if (name.length === 0 || name.length > MAX_ORGANIZATION_NAME_LENGTH) {
    throw new OrganizationError(
      'invalid-organization-name',
      `Organization name must be between 1 and ${MAX_ORGANIZATION_NAME_LENGTH} characters.`,
    )
  }
  return name
}

export interface CreateOrganizationResult {
  organizationId: string
  joinCode: string
}

/**
 * Create an organization as one atomic batch of four documents.
 *
 * Security Rules validate the batch as a unit: each write checks with
 * getAfter() that its counterparts exist and agree, so a lone organization
 * document — or one naming somebody else as Admin — is rejected.
 *
 * The creator's membership starts empty. They are Admin because the
 * organization names them, and the empty membership is what they fall back to
 * if administration is ever transferred away.
 */
export async function createOrganization(params: {
  name: string
  description?: string
}): Promise<CreateOrganizationResult> {
  const uid = requireUid()
  const name = requireName(params.name)
  const db = getFirebaseDb()

  const organizationRef = doc(collection(db, COLLECTIONS.organizations))
  const organizationId = organizationRef.id
  const joinCode = generateJoinCode()

  const batch = writeBatch(db)

  batch.set(
    organizationRef,
    buildOrganizationDocument({
      organizationId,
      name,
      description: params.description,
      uid,
      now: serverTimestamp,
    }),
  )

  batch.set(
    doc(db, COLLECTIONS.memberships, membershipId(organizationId, uid)),
    buildMembershipDocument({ organizationId, uid, now: serverTimestamp }),
  )

  batch.set(
    doc(db, COLLECTIONS.joinCodes, joinCode),
    buildJoinCodeDocument({ organizationId, organizationName: name, uid, now: serverTimestamp }),
  )

  batch.set(
    doc(db, COLLECTIONS.adminSettings, organizationId),
    buildAdminSettingsDocument({ organizationId, joinCode, now: serverTimestamp }),
  )

  await batch.commit()

  return { organizationId, joinCode }
}

export async function getOrganization(organizationId: string): Promise<Organization | null> {
  const snapshot = await getDoc(doc(getFirebaseDb(), COLLECTIONS.organizations, organizationId))
  return snapshot.exists() ? (snapshot.data() as Organization) : null
}

/**
 * Hand administration to another member.
 *
 * No membership is written. Both users' roles change because the effective-role
 * computation reads a different admin_uid, which is also why the outgoing
 * Admin's teams and permissions have to survive untouched.
 */
export async function transferAdmin(params: {
  organizationId: string
  newAdminUid: string
}): Promise<void> {
  const uid = requireUid()
  const db = getFirebaseDb()

  await runTransaction(db, async (transaction) => {
    const organizationRef = doc(db, COLLECTIONS.organizations, params.organizationId)
    const organizationSnapshot = await transaction.get(organizationRef)

    if (!organizationSnapshot.exists()) {
      throw new OrganizationError('organization-not-found', 'Organization not found.')
    }

    const organization = organizationSnapshot.data() as Organization
    if (organization.admin_uid !== uid) {
      throw new OrganizationError('not-admin', 'Only the current Admin can transfer administration.')
    }

    if (organization.admin_uid === params.newAdminUid) {
      throw new OrganizationError('already-admin', 'That member is already the Admin.')
    }

    const targetRef = doc(
      db,
      COLLECTIONS.memberships,
      membershipId(params.organizationId, params.newAdminUid),
    )
    const targetSnapshot = await transaction.get(targetRef)

    if (!targetSnapshot.exists()) {
      throw new OrganizationError(
        'target-membership-not-found',
        'That user is not a member of this organization.',
      )
    }

    if (targetSnapshot.data().is_active !== true) {
      throw new OrganizationError(
        'target-membership-inactive',
        'That membership is deactivated. Reactivate it before transferring administration.',
      )
    }

    transaction.update(organizationRef, {
      admin_uid: params.newAdminUid,
      updated_at: serverTimestamp(),
    })
  })
}

/**
 * Rename an organization.
 *
 * The active join code's name snapshot changes in the same atomic write,
 * because a user validating a code is not yet a member and cannot read the
 * organization document. Security Rules reject a rename that leaves the two
 * disagreeing.
 */
export async function renameOrganization(params: {
  organizationId: string
  name: string
}): Promise<void> {
  const uid = requireUid()
  const name = requireName(params.name)
  const db = getFirebaseDb()

  await runTransaction(db, async (transaction) => {
    const organizationRef = doc(db, COLLECTIONS.organizations, params.organizationId)
    const settingsRef = doc(db, COLLECTIONS.adminSettings, params.organizationId)

    const organizationSnapshot = await transaction.get(organizationRef)
    if (!organizationSnapshot.exists()) {
      throw new OrganizationError('organization-not-found', 'Organization not found.')
    }
    if ((organizationSnapshot.data() as Organization).admin_uid !== uid) {
      throw new OrganizationError('not-admin', 'Only the Admin can rename this organization.')
    }

    const settingsSnapshot = await transaction.get(settingsRef)
    if (!settingsSnapshot.exists()) {
      throw new OrganizationError('admin-settings-not-found', 'Organization settings are missing.')
    }

    const currentCode = settingsSnapshot.data().current_join_code_id as string

    transaction.update(organizationRef, { name, updated_at: serverTimestamp() })
    transaction.update(doc(db, COLLECTIONS.joinCodes, currentCode), {
      organization_name_snapshot: name,
    })
  })
}
