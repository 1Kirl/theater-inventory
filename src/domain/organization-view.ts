import type { EffectiveRole } from '@/domain/effective-role'
import type { OrganizationMembership, PermissionLevel, TheaterTeam } from '@/types/organization'

/**
 * Presentation helpers that stay out of components so they can be tested
 * without rendering anything.
 */

export const ROLE_LABELS: Record<EffectiveRole, string> = {
  admin: 'Admin',
  member: 'Member',
  unassigned: 'Unassigned',
}

export const PERMISSION_LABELS: Record<PermissionLevel, string> = {
  none: 'No access',
  view: 'View',
  edit: 'Edit',
}

/**
 * Resolve a membership's team IDs to names, in the order the teams are listed.
 * An ID with no matching team is dropped rather than shown as a raw ID: teams
 * cannot be deleted in the MVP, so a dangling ID means the caller cannot read
 * that team, and showing the ID would leak nothing useful.
 */
export function teamNamesFor(
  membership: Pick<OrganizationMembership, 'team_ids'> | null,
  teams: readonly TheaterTeam[],
): string[] {
  if (!membership || membership.team_ids.length === 0) return []

  const assigned = new Set(membership.team_ids)
  return teams.filter((team) => assigned.has(team.team_id)).map((team) => team.name)
}

/** "Lighting, Sound and 2 more" — keeps a card from growing without bound. */
export function summarizeTeamNames(names: readonly string[], maxShown = 3): string {
  if (names.length === 0) return 'No teams assigned'
  if (names.length <= maxShown) return names.join(', ')

  const shown = names.slice(0, maxShown).join(', ')
  return `${shown} and ${names.length - maxShown} more`
}
