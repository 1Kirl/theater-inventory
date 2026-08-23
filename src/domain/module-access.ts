import type { EffectiveRole } from '@/domain/effective-role'
import type {
  ModulePermissions,
  OrganizationMembership,
  PermissionLevel,
  PermissionModule,
} from '@/types/organization'

/**
 * Module access, kept separate from team scope.
 *
 * Permission answers *which module, and may I write?* Team answers *which
 * records inside that module?* Only the first question is decided here.
 */

const RANK: Record<PermissionLevel, number> = { none: 0, view: 1, edit: 2 }

export type RequiredLevel = 'view' | 'edit'

export function hasModuleAccess(
  role: EffectiveRole | null,
  permissions: ModulePermissions | null,
  module: PermissionModule,
  required: RequiredLevel,
): boolean {
  // Admin bypasses the permission map entirely, inside this organization only.
  if (role === 'admin') return true
  if (role !== 'member' || !permissions) return false

  return RANK[permissions[module]] >= RANK[required]
}

/**
 * Team scope, applied on top of module access for team-scoped collections.
 *
 * Reading is deliberately not scoped by team: the product exists to show what
 * the whole organization owns. This governs writes only.
 */
export function canEditTeamScopedRecord(
  role: EffectiveRole | null,
  membership: Pick<OrganizationMembership, 'team_ids' | 'permissions'> | null,
  module: PermissionModule,
  recordTeamId: string | null,
): boolean {
  if (role === 'admin') return true
  if (!hasModuleAccess(role, membership?.permissions ?? null, module, 'edit')) return false
  if (!recordTeamId) return false

  return membership?.team_ids.includes(recordTeamId) ?? false
}

/** Teams a non-Admin may assign a record to. Admin may use any team. */
export function assignableTeamIds(
  role: EffectiveRole | null,
  membership: Pick<OrganizationMembership, 'team_ids'> | null,
  allTeamIds: readonly string[],
): string[] {
  if (role === 'admin') return [...allTeamIds]
  if (!membership) return []

  return allTeamIds.filter((teamId) => membership.team_ids.includes(teamId))
}
