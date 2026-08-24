import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { effectiveRole, type EffectiveRole } from '@/domain/effective-role'
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

/**
 * The organization that has been resolved, tagged with the ID it belongs to.
 *
 * The tag is what lets the exposed value be derived rather than cleared: an
 * entry for a different organization, or one left over from a previous account,
 * simply does not match and is not shown.
 */
interface LoadedOrganization {
  organizationId: string
  organization: Organization
  membership: OrganizationMembership
  teams: TheaterTeam[]
}

export function OrganizationProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth()

  const [storedId, setStoredId] = useState<string | null>(readStoredOrganizationId)
  const [loaded, setLoaded] = useState<LoadedOrganization | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Signing out drops the active organization here, during render. Clearing it
  // from an effect would leave one paint in which the next account could see
  // the previous account's organization.
  const activeId = user ? storedId : null
  const active = loaded && loaded.organizationId === activeId ? loaded : null

  // Nothing resolved for an organization we are meant to have, and no error to
  // explain why: that is what loading is.
  const loading = authLoading || (activeId !== null && active === null && error === null)

  const selectOrganization = useCallback((nextId: string) => {
    writeStoredOrganizationId(nextId)
    setStoredId(nextId)
    setError(null)
  }, [])

  const clearOrganization = useCallback(() => {
    writeStoredOrganizationId(null)
    setStoredId(null)
    setError(null)
  }, [])

  const load = useCallback((): Promise<void> => {
    if (!user || !activeId) return Promise.resolve()
    const uid = user.uid

    async function read(): Promise<LoadedOrganization | null> {
      const [organization, membership] = await Promise.all([
        getOrganization(activeId as string),
        getMembership(activeId as string, uid),
      ])

      // The stored organization is gone, was never ours, or our membership was
      // deactivated. Fall back to selection rather than showing a broken shell.
      if (!organization || !membership || !membership.is_active) return null

      return {
        organizationId: activeId as string,
        organization,
        membership,
        teams: await listTeams(activeId as string),
      }
    }

    return read().then(
      (next) => {
        if (!next) {
          clearOrganization()
          return
        }
        setLoaded(next)
        setError(null)
      },
      (caught: unknown) => { setError(toUserFacingMessage(caught)) },
    )
  }, [user, activeId, clearOrganization])

  useEffect(() => {
    if (authLoading) return
    void load()
  }, [authLoading, load])

  // Membership is per user, and the stored ID outlives the session. Only the
  // stored copy is touched here; what the application sees is already derived
  // from `user` above, so there is no state to clear.
  useEffect(() => {
    if (!authLoading && !user) writeStoredOrganizationId(null)
  }, [authLoading, user])

  const role = useMemo<EffectiveRole | null>(() => {
    if (!active || !user) return null
    return effectiveRole(active.organization, active.membership, user.uid)
  }, [active, user])

  const value = useMemo<ActiveOrganizationState>(
    () => ({
      loading,
      organization: active?.organization ?? null,
      membership: active?.membership ?? null,
      role,
      teams: active?.teams ?? [],
      error,
      selectOrganization,
      clearOrganization,
      refresh: load,
    }),
    [loading, active, role, error, selectOrganization, clearOrganization, load],
  )

  return <OrganizationContext.Provider value={value}>{children}</OrganizationContext.Provider>
}
