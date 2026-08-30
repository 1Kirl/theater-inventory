import { effectiveDisplayName, teamNamesOf } from '@/domain/member-profile'
import type { OrganizationMembership, TheaterTeam } from '@/types/organization'
import type { UserProfile } from '@/types/user'

/**
 * The organization directory, as a member browses it.
 *
 * Everything here is presentation over records the application has already read
 * under Security Rules. Searching and filtering narrow what is on screen and
 * never widen what was fetched — a filter that could reach further than the
 * page it filters would be a permission boundary pretending to be a control.
 */

export const ALL_TEAMS = 'all'

export interface ContactRow {
  uid: string
  /** The override where there is one, otherwise the account's own name. */
  name: string
  teamIds: readonly string[]
  teamNames: string[]
  /** Absent rather than empty: a card renders nothing for what nobody entered. */
  phone: string | null
  email: string | null
  bio: string | null
}

export function buildContactRows(params: {
  memberships: readonly OrganizationMembership[]
  teams: readonly TheaterTeam[]
  /** Account names, for members who have not overridden theirs. */
  profiles: ReadonlyMap<string, UserProfile>
}): ContactRow[] {
  return params.memberships
    .filter((membership) => membership.is_active)
    .map((membership) => ({
      uid: membership.uid,
      name: effectiveDisplayName(membership, params.profiles.get(membership.uid)?.display_name),
      teamIds: membership.team_ids,
      teamNames: teamNamesOf(membership, params.teams),
      phone: membership.profile_phone?.trim() || null,
      email: membership.profile_contact_email?.trim() || null,
      bio: membership.profile_bio?.trim() || null,
    }))
    .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }))
}

/**
 * What a search term looks at.
 *
 * Name, team, and contact address — the three things somebody actually knows
 * when they are looking for a person. Phone and biography are deliberately not
 * searched: matching a fragment of somebody's number is not a thing anybody
 * wants, and matching prose produces results nobody can explain.
 */
function haystack(row: ContactRow): string {
  return [row.name, ...row.teamNames, row.email ?? ''].join(' ').toLowerCase()
}

export function matchesSearch(row: ContactRow, search: string): boolean {
  const needle = search.trim().toLowerCase()
  if (needle.length === 0) return true
  return haystack(row).includes(needle)
}

export function matchesTeam(row: ContactRow, teamId: string): boolean {
  if (teamId === ALL_TEAMS) return true
  return row.teamIds.includes(teamId)
}

/**
 * Both narrowings at once.
 *
 * They compose rather than replace: choosing a team and typing a name means
 * both, which is what somebody scanning a crew list expects. Somebody on two
 * teams appears under either filter and once under All — the row is the person,
 * not the membership of a team.
 */
export function filterContacts(
  rows: readonly ContactRow[],
  params: { search: string; teamId: string },
): ContactRow[] {
  return rows.filter(
    (row) => matchesTeam(row, params.teamId) && matchesSearch(row, params.search),
  )
}

/**
 * Whether a team filter still means anything.
 *
 * Teams belong to the organization that defined them. Switching organizations
 * leaves a selected team pointing at nothing, and the directory would come back
 * empty for a reason nobody could see — so the selection falls back to All.
 */
export function resolveTeamFilter(teamId: string, teams: readonly TheaterTeam[]): string {
  if (teamId === ALL_TEAMS) return ALL_TEAMS
  return teams.some((team) => team.team_id === teamId) ? teamId : ALL_TEAMS
}

export type ContactsEmptyState = 'none' | 'no-members' | 'no-matches'

/**
 * An organization with nobody in it and a search that found nobody are
 * different situations, and telling a person the first when it is the second
 * sends them looking for a problem that is not there.
 */
export function emptyStateOf(params: {
  total: number
  visible: number
}): ContactsEmptyState {
  if (params.total === 0) return 'no-members'
  if (params.visible === 0) return 'no-matches'
  return 'none'
}
