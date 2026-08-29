import { useEffect, useState } from 'react'
import { listOrganizationDirectory } from '@/services/membership-service'
import { getUserProfiles } from '@/services/user-service'

export interface TeamMemberOption {
  uid: string
  displayName: string
  teamIds: readonly string[]
}

/**
 * The people a unit can be checked out to.
 *
 * Active memberships only, which `listOrganizationDirectory` already means by
 * default — somebody whose membership was deactivated should not appear as the
 * person holding equipment.
 *
 * Shared by the unit lifecycle dialog and the scanner so both offer the same
 * names under the same rule. A second copy of this would drift the first time
 * one of them changed.
 */
export function useTeamMembers(params: {
  organizationId: string | null | undefined
  /** Skipped entirely when no member is being chosen. */
  enabled: boolean
}): TeamMemberOption[] {
  const { organizationId, enabled } = params
  const [members, setMembers] = useState<TeamMemberOption[]>([])

  useEffect(() => {
    if (!enabled || !organizationId) return

    let cancelled = false

    async function read(): Promise<TeamMemberOption[]> {
      const directory = await listOrganizationDirectory(organizationId as string)
      const profiles = await getUserProfiles(directory.map((entry) => entry.uid))

      return directory.map((entry) => ({
        uid: entry.uid,
        displayName: profiles.get(entry.uid)?.display_name ?? 'Unknown member',
        teamIds: entry.team_ids,
      }))
    }

    read().then(
      (loaded) => { if (!cancelled) setMembers(loaded) },
      // The member is optional everywhere it is offered, so failing to list
      // them is not worth an error screen.
      () => { if (!cancelled) setMembers([]) },
    )

    return () => { cancelled = true }
  }, [enabled, organizationId])

  return members
}

/** Only people actually on the borrowing crew, once one is chosen. */
export function membersOfTeam(
  members: readonly TeamMemberOption[],
  teamId: string | null,
): TeamMemberOption[] {
  if (!teamId) return []
  return members.filter((member) => member.teamIds.includes(teamId))
}
