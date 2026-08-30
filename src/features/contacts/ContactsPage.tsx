import { useCallback, useEffect, useMemo, useState } from 'react'
import { Mail, Phone, Search, Users } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useOrganization } from '@/features/organizations/useOrganization'
import {
  ALL_TEAMS, buildContactRows, emptyStateOf, filterContacts, resolveTeamFilter,
  type ContactRow,
} from '@/features/contacts/contacts-view'
import { listOrganizationDirectory } from '@/services/membership-service'
import { getUserProfiles } from '@/services/user-service'
import { toOrganizationErrorMessage } from '@/services/organization-errors-view'

/**
 * Who is in this organization, what crew they are on, and how to reach them.
 *
 * A directory, not an administration screen: nothing here assigns a team,
 * changes a permission, or edits anybody but the person reading it — those live
 * in Organization Settings and stay there. What a member sees is what other
 * members chose to say about themselves.
 *
 * Searching and filtering narrow the list already loaded. Neither reaches
 * further than the page itself was allowed to.
 */
export function ContactsPage() {
  const { organization, teams } = useOrganization()
  const organizationId = organization?.organization_id

  const [rows, setRows] = useState<ContactRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [teamId, setTeamId] = useState<string>(ALL_TEAMS)

  const load = useCallback((): Promise<void> => {
    if (!organizationId) return Promise.resolve()

    async function read() {
      const memberships = await listOrganizationDirectory(organizationId as string)
      // Account names, for everyone who has not overridden theirs here.
      const profiles = await getUserProfiles(memberships.map((entry) => entry.uid))
        .catch(() => new Map())

      return buildContactRows({ memberships, teams, profiles })
    }

    return read().then(
      (loaded) => { setRows(loaded); setError(null) },
      (caught: unknown) => { setError(toOrganizationErrorMessage(caught)); setRows([]) },
    )
  }, [organizationId, teams])

  useEffect(() => { void load() }, [load])

  // Teams belong to the organization that defined them. Switching organizations
  // leaves a selection pointing at nothing, and the directory would come back
  // empty for a reason nobody could see — so the selection is resolved against
  // the current teams on the way out, rather than corrected afterwards.
  const activeTeamId = resolveTeamFilter(teamId, teams)

  const visible = useMemo(
    () => filterContacts(rows ?? [], { search, teamId: activeTeamId }),
    [rows, search, activeTeamId],
  )

  const emptyState = emptyStateOf({ total: rows?.length ?? 0, visible: visible.length })

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Contacts</h1>
        <p className="text-muted-foreground text-sm">
          Everyone in {organization?.name ?? 'this organization'}, and how to reach them. Teams and
          permissions are managed by your Admin in Organization Settings.
        </p>
      </div>

      <div className="space-y-3">
        <div className="space-y-2">
          <Label htmlFor="contacts-search">Search members</Label>
          <div className="relative">
            <Search
              className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
              aria-hidden="true"
            />
            <Input
              id="contacts-search"
              className="pl-9"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Name, team, or email"
              autoComplete="off"
            />
          </div>
        </div>

        {teams.length > 0 ? (
          <div className="space-y-2">
            <p className="text-sm font-medium" id="contacts-team-filter">Team</p>
            {/* Scrolls rather than wrapping into a wall of chips on a phone. */}
            <div
              className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1"
              role="group"
              aria-labelledby="contacts-team-filter"
            >
              {[{ team_id: ALL_TEAMS, name: 'All' }, ...teams].map((team) => (
                <Button
                  key={team.team_id}
                  type="button"
                  size="sm"
                  variant={activeTeamId === team.team_id ? 'default' : 'outline'}
                  className="shrink-0"
                  aria-pressed={activeTeamId === team.team_id}
                  onClick={() => { setTeamId(team.team_id) }}
                >
                  {team.name}
                </Button>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      {error ? (
        <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>
      ) : null}

      {rows === null ? (
        <p className="text-muted-foreground text-sm">Loading contacts…</p>
      ) : emptyState === 'no-members' ? (
        <p className="text-muted-foreground text-sm">
          Nobody else has joined this organization yet.
        </p>
      ) : emptyState === 'no-matches' ? (
        <p className="text-muted-foreground text-sm">
          No members match this search and team filter.
        </p>
      ) : (
        <>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {visible.map((row) => (
              <li key={row.uid}>
                <Card className="h-full">
                  <CardContent className="space-y-2 pt-6">
                    <p className="font-medium break-words">{row.name}</p>

                    {row.teamNames.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {row.teamNames.map((name) => (
                          <Badge key={name} variant="secondary">{name}</Badge>
                        ))}
                      </div>
                    ) : (
                      <p className="text-muted-foreground text-xs">No team yet</p>
                    )}

                    {row.bio ? (
                      <p className="text-muted-foreground text-sm break-words">{row.bio}</p>
                    ) : null}

                    {/* Only what somebody chose to share. Nothing is filled in
                        with a placeholder that would read as a fact. */}
                    {row.email ? (
                      <p className="flex items-center gap-2 text-sm">
                        <Mail className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
                        <a
                          href={`mailto:${row.email}`}
                          className="min-w-0 truncate underline underline-offset-4"
                        >
                          {row.email}
                        </a>
                      </p>
                    ) : null}

                    {row.phone ? (
                      <p className="flex items-center gap-2 text-sm">
                        <Phone className="text-muted-foreground size-4 shrink-0" aria-hidden="true" />
                        <a href={`tel:${row.phone}`} className="underline underline-offset-4">
                          {row.phone}
                        </a>
                      </p>
                    ) : null}
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>

          <p className="text-muted-foreground flex items-center gap-2 text-xs">
            <Users className="size-3.5" aria-hidden="true" />
            {visible.length} of {rows.length} member{rows.length === 1 ? '' : 's'}
          </p>
        </>
      )}
    </div>
  )
}
