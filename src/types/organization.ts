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

  /**
   * How this person appears and can be reached *in this organization*.
   *
   * All optional, all absent from every membership written before contacts
   * existed, and all owned by the member rather than the Admin. Somebody who
   * belongs to two organizations has two of these, and neither knows about the
   * other — which is the point: a volunteer at one school and a student at
   * another are not obliged to present themselves the same way to both.
   *
   * The account's own `display_name` is never copied in here. An absent
   * override falls back to it, so changing the global name still works.
   */
  profile_display_name?: string
  profile_phone?: string
  /** Entered by the member. Never the synthetic address used to authenticate. */
  profile_contact_email?: string
  profile_bio?: string
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
