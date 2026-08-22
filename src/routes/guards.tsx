import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { useAuth } from '@/features/auth/useAuth'
import { paths } from '@/routes/paths'

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

/** Requires an authenticated Firebase user. */
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
    return <Navigate to={paths.logIn} replace state={{ from: location.pathname }} />
  }

  return <Outlet />
}

/** Keeps signed-in users away from the sign-up and log-in screens. */
export function GuestGuard() {
  const { loading, user, configError } = useAuth()

  if (configError) {
    return <ConfigErrorScreen message={configError} />
  }

  if (loading) {
    return <LoadingScreen />
  }

  if (user) {
    return <Navigate to={paths.organizations} replace />
  }

  return <Outlet />
}
