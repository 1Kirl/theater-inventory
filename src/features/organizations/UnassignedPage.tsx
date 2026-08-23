import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { SignOutButton } from '@/features/auth/SignOutButton'
import { useOrganization } from '@/features/organizations/useOrganization'
import { paths } from '@/routes/paths'

/**
 * Shown when an active membership carries no teams and no module access. The
 * account and the join both worked; what is missing is an assignment.
 */
export function UnassignedPage() {
  const navigate = useNavigate()
  const { organization, clearOrganization } = useOrganization()

  function backToSelection() {
    clearOrganization()
    navigate(paths.organizations, { replace: true })
  }

  return (
    <div className="bg-background text-foreground flex min-h-svh flex-col items-center justify-center px-4 py-10">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{organization?.name ?? 'Organization'}</CardTitle>
          <CardDescription>Waiting for an assignment</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm">
            Your administrator needs to assign you to a team and permissions before you can use this
            organization.
          </p>
          <p className="text-muted-foreground text-sm">
            You have joined successfully. Nothing else is needed from you — once an Admin assigns
            you, this organization opens normally.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={backToSelection}>
              Back to organizations
            </Button>
            <SignOutButton />
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
