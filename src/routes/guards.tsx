import { Suspense } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { useAuth } from '@/features/auth/useAuth'
import { useOrganization } from '@/features/organizations/useOrganization'
import { UnassignedPage } from '@/features/organizations/UnassignedPage'
import { hasModuleAccess, type RequiredLevel } from '@/domain/module-access'
import { paths } from '@/routes/paths'
import { afterAuthDestination, locationToReturnPath } from '@/routes/return-to'
import type { PermissionModule } from '@/types/organization'

function FullPageMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-svh items-center justify-center px-4">
      <div className="w-full max-w-md">{children}</div>
    </div>
  )
}

function LoadingScreen() {
  return (
    <FullPageMessage>
      <p className="text-muted-foreground text-center text-sm">Loading…</p>
    </FullPageMessage>
  )
}

function ConfigErrorScreen({ message }: { message: string }) {
  return (
    <FullPageMessage>
      <Alert variant="destructive">
        <AlertTitle>Firebase is not configured</AlertTitle>
        <AlertDescription>
          {message} Copy .env.example to .env.local and fill in the values, then restart the dev
          server.
        </AlertDescription>
      </Alert>
    </FullPageMessage>
  )
}

/**
 * Sends someone to organization selection without losing where they were going.
 *
 * A scanned equipment label is a deep link into an organization that may not be
 * the active one — or into an account with no active organization at all. The
 * destination rides along so that picking an organization finishes the journey
 * instead of dropping the person on the dashboard.
 */
function ToOrganizationSelection() {
  const location = useLocation()
  return (
    <Navigate
      to={paths.organizations}
      replace
      state={{ from: locationToReturnPath(location) }}
    />
  )
}

/**
 * Requires an authenticated Firebase user.
 *
 * Also the outer Suspense boundary for the routes that sit outside the
 * application shell — organization selection, create, and join — whose code is
 * fetched on demand like every other page. Routes inside the shell have their
 * own boundary there, so the sidebar stays on screen instead of being replaced.
 */
export function AuthGuard() {
  const { loading, user, configError } = useAuth()
  const location = useLocation()

  if (configError) {
    return <ConfigErrorScreen message={configError} />
  }

  if (loading) {
    return <LoadingScreen />
  }

  if (!user) {
    return (
      <Navigate to={paths.logIn} replace state={{ from: locationToReturnPath(location) }} />
    )
  }

  return (
    <Suspense fallback={<LoadingScreen />}>
      <Outlet />
    </Suspense>
  )
}

/**
 * Requires an active organization, and an assignment inside it.
 *
 * Admin passes regardless of teams and permissions, because administration is
 * the organization's `admin_uid` rather than anything on their membership.
 * Module-level PermissionGuard arrives in Phase 3 and will nest inside this.
 */
export function OrganizationGuard() {
  const { loading, organization, role } = useOrganization()

  if (loading) {
    return <LoadingScreen />
  }

  if (!organization) {
    return <ToOrganizationSelection />
  }

  if (role === 'unassigned') {
    return <UnassignedPage />
  }

  return <Outlet />
}

/**
 * Requires an active membership, and nothing more.
 *
 * The narrow exception to `OrganizationGuard`, for the one place where being a
 * member is the whole qualification. Somebody who joined with a code and is
 * waiting for an assignment is a member of the organization: they may see who
 * else is here and say how to reach them. Nothing else opens — every module
 * still asks for a permission they do not have, and this guard grants none.
 *
 * Security Rules have always drawn the line in the same place: `isActiveMemberOf`
 * asks whether the membership is active and never whether it carries a team.
 */
export function MembershipGuard() {
  const { loading, organization, membership } = useOrganization()

  if (loading) {
    return <LoadingScreen />
  }

  if (!organization) {
    return <ToOrganizationSelection />
  }

  if (!membership?.is_active) {
    return <ToOrganizationSelection />
  }

  return <Outlet />
}

/**
 * Requires a module permission. Nests inside OrganizationGuard, so an
 * Unassigned member never reaches it.
 *
 * This decides module access only. Team scope is a separate axis, applied to
 * individual records by the services, the interface, and — authoritatively —
 * Security Rules.
 */
export function PermissionGuard({
  module,
  level,
}: {
  module: PermissionModule
  level: RequiredLevel
}) {
  const { loading, organization, role, membership } = useOrganization()

  if (loading) {
    return <LoadingScreen />
  }

  if (!organization) {
    return <ToOrganizationSelection />
  }

  if (!hasModuleAccess(role, membership?.permissions ?? null, module, level)) {
    return (
      <FullPageMessage>
        <Alert variant="destructive">
          <AlertTitle>No access to this module</AlertTitle>
          <AlertDescription>
            Your Admin has not given you access here. Ask them if you need it.
          </AlertDescription>
        </Alert>
      </FullPageMessage>
    )
  }

  return <Outlet />
}

/** Admin-only routes. Security Rules enforce this independently. */
export function AdminGuard() {
  const { loading, organization, role } = useOrganization()

  if (loading) {
    return <LoadingScreen />
  }

  if (!organization) {
    return <ToOrganizationSelection />
  }

  if (role !== 'admin') {
    return (
      <FullPageMessage>
        <Alert variant="destructive">
          <AlertTitle>Admin only</AlertTitle>
          <AlertDescription>
            Only this organization's Admin can open its settings.
          </AlertDescription>
        </Alert>
      </FullPageMessage>
    )
  }

  return <Outlet />
}

/**
 * Keeps signed-in users away from the sign-up and log-in screens.
 *
 * This redirect fires the moment authentication succeeds — the auth state
 * update re-renders it while the sign-in screen is still mounted — so it
 * arrives within a frame of the screen's own redirect and lands after it. It
 * therefore has to agree about the destination, or a deep link that survived
 * everything else is thrown away at the last step by the guard whose only job
 * was to keep signed-in people off the login form.
 */
export function GuestGuard() {
  const { loading, user, configError } = useAuth()
  const location = useLocation()

  if (configError) {
    return <ConfigErrorScreen message={configError} />
  }

  if (loading) {
    return <LoadingScreen />
  }

  if (user) {
    return <Navigate to={afterAuthDestination(location.state)} replace />
  }

  return <Outlet />
}
