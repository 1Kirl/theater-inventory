import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useOrganization } from '@/features/organizations/useOrganization'
import { PERMISSION_LABELS, summarizeTeamNames, teamNamesFor } from '@/domain/organization-view'
import { PERMISSION_MODULES } from '@/types/organization'
import { paths } from '@/routes/paths'

const MODULE_LABELS: Record<(typeof PERMISSION_MODULES)[number], string> = {
  inventory: 'Inventory',
  maintenance: 'Maintenance',
  productions: 'Productions',
  calendar: 'Calendar',
}

/**
 * Phase 2B landing page. The real dashboard is built in Phase 3 once inventory,
 * maintenance, productions, and calendar exist to summarize.
 */
export function DashboardPlaceholder() {
  const { organization, membership, role, teams } = useOrganization()
  const isAdmin = role === 'admin'

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{organization?.name}</h1>
        <p className="text-muted-foreground text-sm">
          {isAdmin
            ? 'You administer this organization.'
            : summarizeTeamNames(teamNamesFor(membership, teams))}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Your access</CardTitle>
          <CardDescription>
            {isAdmin
              ? 'Admin access covers every module, regardless of teams and permissions.'
              : 'Set by your Admin. Ask them if something you need is missing.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            {PERMISSION_MODULES.map((module) => {
              const level = membership?.permissions[module] ?? 'none'
              // A module the user has no access to is listed as such, and never
              // carries data from it.
              return (
                <div key={module}>
                  <dt className="text-muted-foreground">{MODULE_LABELS[module]}</dt>
                  <dd className="font-medium">
                    {isAdmin ? 'Full access' : PERMISSION_LABELS[level]}
                  </dd>
                </div>
              )
            })}
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Not built yet</CardTitle>
          <CardDescription>
            Inventory, maintenance, productions, the action list, and the calendar arrive from
            Phase 3 onward. This page becomes the real dashboard then.
          </CardDescription>
        </CardHeader>
        {isAdmin ? (
          <CardContent>
            <Button asChild variant="outline" size="sm">
              <Link to={paths.organizationSettings}>Open organization settings</Link>
            </Button>
          </CardContent>
        ) : null}
      </Card>
    </div>
  )
}
