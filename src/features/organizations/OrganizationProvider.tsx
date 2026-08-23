import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { effectiveRole, type EffectiveRole } from '@/domain/effective-role'
import { membershipId } from '@/domain/organization-ids'
import { useAuth } from '@/features/auth/useAuth'
import { getOrganization } from '@/services/organization-service'
import { getMembership } from '@/services/membership-service'
import { listTeams } from '@/services/team-service'
import { toUserFacingMessage } from '@/services/auth-errors'
import { OrganizationContext, type ActiveOrganizationState } from '@/features/organizations/organization-context'
import type { Organization, OrganizationMembership, TheaterTeam } from '@/types/organization'

const STORAGE_KEY = 'theater-inventory.active-organization-id'

/**
 * Only the organization ID is remembered across reloads. Everything that
 * governs access — membership, permissions, role — is re-read from Firestore,
 * because a stored copy would be a second source of truth that an Admin's
 * change could not reach.
 */
function readStoredOrganizationId(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

function writeStoredOrganizationId(organizationId: string | null): void {
  try {
    if (organizationId === null) {
      window.localStorage.removeItem(STORAGE_KEY)
    } else {
      window.localStorage.setItem(STORAGE_KEY, organizationId)
    }
  } catch {
    // A private window or blocked storage is not a failure worth surfacing.
  }
}

export function OrganizationProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth()

  const [organizationId, setOrganizationId] = useState<string | null>(readStoredOrganizationId)
  const [organization, setOrganization] = useState<Organization | null>(null)
  const [membership, setMembership] = useState<OrganizationMembership | null>(null)
  const [teams, setTeams] = useState<TheaterTeam[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selectOrganization = useCallback((nextId: string) => {
    writeStoredOrganizationId(nextId)
    setOrganizationId(nextId)
  }, [])

  const clearOrganization = useCallback(() => {
    writeStoredOrganizationId(null)
    setOrganizationId(null)
    setOrganization(null)
    setMembership(null)
    setTeams([])
    setError(null)
  }, [])

  const load = useCallback(async () => {
    if (!user || !organizationId) {
      setOrganization(null)
      setMembership(null)
      setTeams([])
      return
    }

    setLoading(true)
    setError(null)

    try {
      const [nextOrganization, nextMembership] = await Promise.all([
        getOrganization(organizationId),
        getMembership(organizationId, user.uid),
      ])

      if (!nextOrganization || !nextMembership || !nextMembership.is_active) {
        // The stored organization is gone, was never ours, or our membership was
        // deactivated. Fall back to selection rather than showing a broken shell.
        clearOrganization()
        return
      }

      setOrganization(nextOrganization)
      setMembership(nextMembership)
      setTeams(await listTeams(organizationId))
    } catch (caught) {
      setError(toUserFacingMessage(caught))
      setOrganization(null)
      setMembership(null)
      setTeams([])
    } finally {
      setLoading(false)
    }
  }, [user, organizationId, clearOrganization])

  useEffect(() => {
    if (authLoading) return
    void load()
  }, [authLoading, load])

  // Membership is per user. Signing out must not leave the next account looking
  // at the previous one's organization.
  useEffect(() => {
    if (!authLoading && !user) {
      clearOrganization()
    }
  }, [authLoading, user, clearOrganization])

  const role = useMemo<EffectiveRole | null>(() => {
    if (!organization || !user) return null
    return effectiveRole(organization, membership, user.uid)
  }, [organization, membership, user])

  const value = useMemo<ActiveOrganizationState>(
    () => ({
      loading: authLoading || loading,
      organization,
      membership,
      role,
      teams,
      error,
      selectOrganization,
      clearOrganization,
      refresh: load,
    }),
    [authLoading, loading, organization, membership, role, teams, error, selectOrganization, clearOrganization, load],
  )

  return <OrganizationContext.Provider value={value}>{children}</OrganizationContext.Provider>
}

export { membershipId }
