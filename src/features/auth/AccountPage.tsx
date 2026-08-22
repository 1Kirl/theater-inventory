import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ChangePasswordCard } from '@/features/auth/ChangePasswordCard'
import { SignOutButton } from '@/features/auth/SignOutButton'
import { useAuth } from '@/features/auth/useAuth'

/**
 * Personal account settings. Organization membership summary is added in Phase 2.
 */
export function AccountPage() {
  const { profile } = useAuth()

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Account</h1>
        <p className="text-muted-foreground text-sm">
          Your personal account, independent from any organization.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Profile</CardTitle>
          <CardDescription>User ID cannot be changed.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">User ID</dt>
              <dd className="font-medium">{profile?.user_id ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Display name</dt>
              <dd className="font-medium">{profile?.display_name ?? '—'}</dd>
            </div>
          </dl>
          <SignOutButton />
        </CardContent>
      </Card>

      <ChangePasswordCard />
    </div>
  )
}
