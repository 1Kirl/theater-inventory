import type { Timestamp } from 'firebase/firestore'

export type PermissionLevel = 'none' | 'view' | 'edit'

export const PERMISSION_MODULES = [
  'inventory',
  'maintenance',
  'productions',
  'calendar',
] as const

export type PermissionModule = (typeof PERMISSION_MODULES)[number]

export type ModulePermissions = Record<PermissionModule, PermissionLevel>

/** Path: organizations/{organizationId} */
export interface Organization {
  organization_id: string
  name: string
  description?: string
  /** The single current Admin. Administration lives here, not on a membership. */
  admin_uid: string
  created_by_uid: string
  created_at: Timestamp
  updated_at: Timestamp
}

/**
 * Path: organization_memberships/{organizationId}_{uid}
 *
 * There is deliberately no role field. See `effectiveRole`.
 */
export interface OrganizationMembership {
  organization_id: string
  uid: string
  team_ids: string[]
  permissions: ModulePermissions
  is_active: boolean
  joined_at: Timestamp
  updated_at: Timestamp
}

/**
 * Path: organization_join_codes/{code}
 *
 * The document ID is the canonical code and is not repeated as a field.
 */
export interface OrganizationJoinCode {
  organization_id: string
  /** Lets a non-member name the organization before joining. */
  organization_name_snapshot: string
  active: boolean
  created_by_uid: string
  created_at: Timestamp
  revoked_at?: Timestamp
}

/** Path: teams/{teamId} — organization-level, not scoped to a member. */
export interface TheaterTeam {
  team_id: string
  organization_id: string
  name: string
  description?: string
  created_at: Timestamp
  updated_at: Timestamp
}

/** Path: organization_admin_settings/{organizationId} — Admin-only. */
export interface OrganizationAdminSettings {
  organization_id: string
  current_join_code_id: string
  updated_at: Timestamp
}

/** Path: organization_membership_join_proofs/{organizationId}_{uid} */
export interface MembershipJoinProof {
  organization_id: string
  uid: string
  join_code_id: string
  created_at: Timestamp
}

export const EMPTY_PERMISSIONS: ModulePermissions = {
  inventory: 'none',
  maintenance: 'none',
  productions: 'none',
  calendar: 'none',
}
