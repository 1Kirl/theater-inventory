import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { SignOutButton } from '@/features/auth/SignOutButton'
import { useAuth } from '@/features/auth/useAuth'
import { paths } from '@/routes/paths'

/**
 * Placeholder for Organization Selection. The real page — membership list,
 * Create Organization, and Join Organization — is built in Phase 2.
 */
export function OrganizationSelectionPlaceholder() {
  const { profile } = useAuth()

  return (
    <div className="bg-background text-foreground flex min-h-svh flex-col items-center justify-center gap-6 px-4 py-10">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Organizations</CardTitle>
          <CardDescription>
            {profile ? `Signed in as ${profile.display_name}.` : 'Signed in.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-muted-foreground text-sm">
            Creating and joining theater organizations is built in Phase 2. Your account exists and
            is ready.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" size="sm">
              <Link to={paths.account}>Account settings</Link>
            </Button>
            <SignOutButton />
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
