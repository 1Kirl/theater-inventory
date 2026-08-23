import { readFileSync } from 'node:fs'
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import { doc, setDoc, serverTimestamp, type Firestore } from 'firebase/firestore'

export { assertFails, assertSucceeds }

export const PROJECT_ID = 'demo-theater-inventory'

export const ADMIN = 'uid-admin'
export const MEMBER = 'uid-member'
export const OUTSIDER = 'uid-outsider'

export const ORG_A = 'orgAAAAAAAAAAAAAAAAA'
export const ORG_B = 'orgBBBBBBBBBBBBBBBBB'

export const CODE_A = 'K7PFN4XQT3WMH9RC'
export const CODE_A2 = 'M4TDQ8ZKR6VXJ2NP'
export const CODE_B = 'H3WRK9TQV5XZ7MDN'

export const NO_PERMISSIONS = {
  inventory: 'none',
  maintenance: 'none',
  productions: 'none',
  calendar: 'none',
} as const

export const SOME_PERMISSIONS = {
  inventory: 'view',
  maintenance: 'none',
  productions: 'edit',
  calendar: 'view',
} as const

export function membershipId(organizationId: string, uid: string): string {
  return `${organizationId}_${uid}`
}

export async function createTestEnvironment(): Promise<RulesTestEnvironment> {
  return initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      host: '127.0.0.1',
      port: 8080,
      rules: readFileSync('firestore.rules', 'utf8'),
    },
  })
}

/** Seeds one organization with an Admin, a Member, and an active join code. */
export async function seedOrganization(
  environment: RulesTestEnvironment,
  options: {
    organizationId: string
    adminUid: string
    code: string
    name?: string
    members?: { uid: string; isActive?: boolean; assigned?: boolean }[]
  },
): Promise<void> {
  const name = options.name ?? 'Seed Theater'

  await environment.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore() as unknown as Firestore

    await setDoc(doc(db, 'organizations', options.organizationId), {
      organization_id: options.organizationId,
      name,
      admin_uid: options.adminUid,
      created_by_uid: options.adminUid,
      created_at: serverTimestamp(),
      updated_at: serverTimestamp(),
    })

    await setDoc(doc(db, 'organization_admin_settings', options.organizationId), {
      organization_id: options.organizationId,
      current_join_code_id: options.code,
      updated_at: serverTimestamp(),
    })

    await setDoc(doc(db, 'organization_join_codes', options.code), {
      organization_id: options.organizationId,
      organization_name_snapshot: name,
      active: true,
      created_by_uid: options.adminUid,
      created_at: serverTimestamp(),
    })

    const everyone = [{ uid: options.adminUid }, ...(options.members ?? [])]
    for (const member of everyone) {
      const assigned = 'assigned' in member ? member.assigned : false
      await setDoc(doc(db, 'organization_memberships', membershipId(options.organizationId, member.uid)), {
        organization_id: options.organizationId,
        uid: member.uid,
        team_ids: assigned ? ['team-lighting'] : [],
        permissions: assigned ? SOME_PERMISSIONS : NO_PERMISSIONS,
        is_active: 'isActive' in member ? member.isActive !== false : true,
        joined_at: serverTimestamp(),
        updated_at: serverTimestamp(),
      })
    }
  })
}

export function newMembership(organizationId: string, uid: string) {
  return {
    organization_id: organizationId,
    uid,
    team_ids: [],
    permissions: NO_PERMISSIONS,
    is_active: true,
    joined_at: serverTimestamp(),
    updated_at: serverTimestamp(),
  }
}

export function newJoinProof(organizationId: string, uid: string, code: string) {
  return {
    organization_id: organizationId,
    uid,
    join_code_id: code,
    created_at: serverTimestamp(),
  }
}

export function newOrganization(organizationId: string, uid: string, name = 'New Theater') {
  return {
    organization_id: organizationId,
    name,
    admin_uid: uid,
    created_by_uid: uid,
    created_at: serverTimestamp(),
    updated_at: serverTimestamp(),
  }
}

export function newJoinCode(organizationId: string, uid: string, name = 'New Theater') {
  return {
    organization_id: organizationId,
    organization_name_snapshot: name,
    active: true,
    created_by_uid: uid,
    created_at: serverTimestamp(),
  }
}

export function newAdminSettings(organizationId: string, code: string) {
  return {
    organization_id: organizationId,
    current_join_code_id: code,
    updated_at: serverTimestamp(),
  }
}
