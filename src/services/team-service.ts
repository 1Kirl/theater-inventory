import {
  collection,
  doc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore'
import { getFirebaseDb } from '@/lib/firebase'
import { COLLECTIONS } from '@/domain/organization-ids'
import { OrganizationError } from '@/domain/organization-errors'
import { buildTeamDocument } from '@/domain/organization-payloads'
import type { TheaterTeam } from '@/types/organization'

const MAX_TEAM_NAME_LENGTH = 60

function requireTeamName(rawName: string): string {
  const name = rawName.trim()
  if (name.length === 0 || name.length > MAX_TEAM_NAME_LENGTH) {
    throw new OrganizationError(
      'invalid-team-name',
      `Team name must be between 1 and ${MAX_TEAM_NAME_LENGTH} characters.`,
    )
  }
  return name
}

/**
 * Teams are organization-level. Any active member may read them, because team
 * names appear on membership badges and in the assignment interface.
 */
export async function listTeams(organizationId: string): Promise<TheaterTeam[]> {
  const snapshot = await getDocs(
    query(
      collection(getFirebaseDb(), COLLECTIONS.teams),
      where('organization_id', '==', organizationId),
    ),
  )

  return snapshot.docs
    .map((entry) => entry.data() as TheaterTeam)
    .sort((left, right) => left.name.localeCompare(right.name))
}

/** Admin only, enforced by Security Rules. */
export async function createTeam(params: {
  organizationId: string
  name: string
  description?: string
}): Promise<{ teamId: string }> {
  const name = requireTeamName(params.name)
  const db = getFirebaseDb()
  const teamRef = doc(collection(db, COLLECTIONS.teams))

  await setDoc(
    teamRef,
    buildTeamDocument({
      teamId: teamRef.id,
      organizationId: params.organizationId,
      name,
      description: params.description,
      now: serverTimestamp,
    }),
  )

  return { teamId: teamRef.id }
}

/**
 * Admin only. Teams have no delete flow in the MVP: membership.team_ids and,
 * from Phase 3, inventory and maintenance records would point at nothing.
 */
export async function renameTeam(params: { teamId: string; name: string }): Promise<void> {
  const name = requireTeamName(params.name)
  await updateDoc(doc(getFirebaseDb(), COLLECTIONS.teams, params.teamId), {
    name,
    updated_at: serverTimestamp(),
  })
}
