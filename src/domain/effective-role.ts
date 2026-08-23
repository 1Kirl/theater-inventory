import type { ModulePermissions, Organization, OrganizationMembership } from '@/types/organization'

export type EffectiveRole = 'admin' | 'member' | 'unassigned'

/**
 * A membership satisfies the assignment condition when it is active, holds at
 * least one team, and grants at least one module at view or edit.
 */
export function satisfiesAssignmentCondition(
  membership: Pick<OrganizationMembership, 'is_active' | 'team_ids' | 'permissions'> | null,
): boolean {
  if (!membership || !membership.is_active) return false
  if (membership.team_ids.length === 0) return false

  return hasAnyModuleAccess(membership.permissions)
}

export function hasAnyModuleAccess(permissions: ModulePermissions): boolean {
  return Object.values(permissions).some((level) => level === 'view' || level === 'edit')
}

/**
 * Role is computed, never stored.
 *
 * Administration is `organizations.admin_uid`, so an Admin reads as Admin
 * regardless of teams and permissions — and those fields survive untouched,
 * because they are the only input this computation has once administration is
 * transferred away.
 *
 * Security Rules evaluate the same conditions, so the interface and the
 * authorization boundary cannot drift apart.
 */
export function effectiveRole(
  organization: Pick<Organization, 'admin_uid'>,
  membership: Pick<OrganizationMembership, 'is_active' | 'team_ids' | 'permissions'> | null,
  uid: string,
): EffectiveRole {
  if (organization.admin_uid === uid) return 'admin'
  return satisfiesAssignmentCondition(membership) ? 'member' : 'unassigned'
}
