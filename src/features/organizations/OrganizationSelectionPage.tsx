import { useCallback, useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Building2, Plus, Ticket } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { SignOutButton } from '@/features/auth/SignOutButton'
import { useAuth } from '@/features/auth/useAuth'
import { useOrganization } from '@/features/organizations/useOrganization'
import { effectiveRole } from '@/domain/effective-role'
import { ROLE_LABELS, summarizeTeamNames, teamNamesFor } from '@/domain/organization-view'
import { listMyActiveMemberships } from '@/services/membership-service'
import { getOrganization } from '@/services/organization-service'
import { listTeams } from '@/services/team-service'
import { toUserFacingMessage } from '@/services/auth-errors'
import { paths } from '@/routes/paths'
import { returnToFromState } from '@/routes/return-to'
import type { Organization, OrganizationMembership, TheaterTeam } from '@/types/organization'

interface MembershipCard {
  organization: Organization
  membership: OrganizationMembership
  teams: TheaterTeam[]
}

export function OrganizationSelectionPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user, profile } = useAuth()
  const { selectOrganization } = useOrganization()

  // Set when a guard sent the person here on the way to somewhere specific —
  // scanning an equipment label, most often. Only internal paths are honoured.
  const returnTo = returnToFromState(location.state)

  const [cards, setCards] = useState<MembershipCard[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  // State settles in the promise continuations rather than synchronously, so
  // the effect starts the read and nothing else. Returning the promise keeps
  // `load` awaitable for callers that refresh after a write.
  const load = useCallback((): Promise<void> => {
    async function read() {
      const memberships = await listMyActiveMemberships()

      const loaded = await Promise.all(
        memberships.map(async (membership) => {
          const [organization, teams] = await Promise.all([
            getOrganization(membership.organization_id),
            listTeams(membership.organization_id),
          ])
          return organization ? { organization, membership, teams } : null
        }),
      )

      return loaded
        .filter((entry): entry is MembershipCard => entry !== null)
        .sort((left, right) => left.organization.name.localeCompare(right.organization.name))
    }

    return read().then(
      (loaded) => { setCards(loaded); setError(null) },
      (caught: unknown) => { setError(toUserFacingMessage(caught)); setCards([]) },
    )
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  function enter(organizationId: string) {
    selectOrganization(organizationId)
    // If the destination belongs to a different organization than the one just
    // chosen, its own page says so and offers to switch. Nothing here needs to
    // guess which organization a link belongs to.
    navigate(returnTo ?? paths.dashboard)
  }

  return (
    <div className="bg-background text-foreground min-h-svh">
      <header className="border-border bg-background/95 sticky top-0 z-10 flex h-14 items-center gap-3 border-b px-4 backdrop-blur">
        <span className="truncate text-sm font-semibold">Theater Inventory Tracker</span>
        <div className="ml-auto flex items-center gap-2">
          <Button asChild variant="ghost" size="sm">
            <Link to={paths.account}>
              <span className="max-w-32 truncate">{profile?.display_name ?? 'Account'}</span>
            </Link>
          </Button>
          <SignOutButton variant="ghost" />
        </div>
      </header>

      <main className="mx-auto w-full max-w-4xl space-y-6 px-4 py-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">Organizations</h1>
            <p className="text-muted-foreground text-sm">
              {returnTo === null
                ? 'Choose a theater organization to work in. Your role and teams are separate in each one.'
                : 'Choose the organization this equipment belongs to. You will be taken straight to it.'}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm">
              <Link to={paths.createOrganization}>
                <Plus className="size-4" aria-hidden="true" />
                Create
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link to={paths.joinOrganization}>
                <Ticket className="size-4" aria-hidden="true" />
                Join with a code
              </Link>
            </Button>
          </div>
        </div>

        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {cards === null ? (
          <p className="text-muted-foreground text-sm">Loading organizations…</p>
        ) : cards.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">You are not in an organization yet</CardTitle>
              <CardDescription>
                Create one to become its Admin, or join an existing one with a code from your
                director or stage manager.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Button asChild>
                <Link to={paths.createOrganization}>Create Organization</Link>
              </Button>
              <Button asChild variant="outline">
                <Link to={paths.joinOrganization}>Join Organization</Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {cards.map(({ organization, membership, teams }) => {
              const role = user ? effectiveRole(organization, membership, user.uid) : 'unassigned'
              const names = teamNamesFor(membership, teams)

              return (
                <li key={organization.organization_id}>
                  <Card className="h-full">
                    <CardHeader>
                      <div className="flex items-start justify-between gap-2">
                        <CardTitle className="flex min-w-0 items-center gap-2 text-base">
                          <Building2 className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
                          <span className="truncate">{organization.name}</span>
                        </CardTitle>
                        <Badge variant={role === 'admin' ? 'default' : 'secondary'}>
                          {ROLE_LABELS[role]}
                        </Badge>
                      </div>
                      <CardDescription>{summarizeTeamNames(names)}</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <Button
                        className="w-full sm:w-auto"
                        onClick={() => enter(organization.organization_id)}
                      >
                        Enter
                      </Button>
                    </CardContent>
                  </Card>
                </li>
              )
            })}
          </ul>
        )}
      </main>
    </div>
  )
}
