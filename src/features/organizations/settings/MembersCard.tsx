import { useCallback, useEffect, useState } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { MemberAssignmentDialog } from '@/features/organizations/settings/MemberAssignmentDialog'
import { useOrganization } from '@/features/organizations/useOrganization'
import { effectiveRole } from '@/domain/effective-role'
import { ROLE_LABELS, summarizeTeamNames, teamNamesFor } from '@/domain/organization-view'
import { listOrganizationDirectory, setMembershipActive } from '@/services/membership-service'
import { getUserProfiles } from '@/services/user-service'
import { toOrganizationErrorMessage } from '@/services/organization-errors-view'
import type { OrganizationMembership } from '@/types/organization'

interface DirectoryRow {
  membership: OrganizationMembership
  displayName: string
  userId: string
}

export function MembersCard() {
  const { organization, teams, refresh } = useOrganization()
  const organizationId = organization?.organization_id ?? null

  const [rows, setRows] = useState<DirectoryRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busyUid, setBusyUid] = useState<string | null>(null)
  const [editing, setEditing] = useState<DirectoryRow | null>(null)

  const load = useCallback(async () => {
    if (!organizationId) return
    setError(null)
    try {
      // Admin only: including deactivated members is what the rule permits for
      // an Admin and denies for anyone else.
      const memberships = await listOrganizationDirectory(organizationId, { includeInactive: true })
      const profiles = await getUserProfiles(memberships.map((entry) => entry.uid))

      setRows(
        memberships
          .map((membership) => ({
            membership,
            displayName: profiles.get(membership.uid)?.display_name ?? 'Unknown member',
            userId: profiles.get(membership.uid)?.user_id ?? '—',
          }))
          .sort((left, right) => left.displayName.localeCompare(right.displayName)),
      )
    } catch (caught) {
      setError(toOrganizationErrorMessage(caught))
      setRows([])
    }
  }, [organizationId])

  useEffect(() => {
    void load()
  }, [load])

  async function toggleActive(row: DirectoryRow) {
    if (!organizationId) return
    setBusyUid(row.membership.uid)
    setError(null)
    try {
      await setMembershipActive({
        organizationId,
        uid: row.membership.uid,
        isActive: !row.membership.is_active,
      })
      await load()
    } catch (caught) {
      setError(toOrganizationErrorMessage(caught))
    } finally {
      setBusyUid(null)
    }
  }

  const unassignedCount =
    rows?.filter(
      (row) =>
        organization &&
        effectiveRole(organization, row.membership, row.membership.uid) === 'unassigned' &&
        row.membership.is_active,
    ).length ?? 0

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Members</CardTitle>
        <CardDescription>
          People appear here after joining with the organization code. There is no way to add an
          account for someone else.
          {unassignedCount > 0
            ? ` ${unassignedCount} member${unassignedCount === 1 ? '' : 's'} waiting for an assignment.`
            : ''}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {rows === null ? (
          <p className="text-muted-foreground text-sm">Loading members…</p>
        ) : rows.length === 0 ? (
          <p className="text-muted-foreground text-sm">No members yet.</p>
        ) : (
          <ul className="divide-border divide-y">
            {rows.map((row) => {
              const role = organization
                ? effectiveRole(organization, row.membership, row.membership.uid)
                : 'unassigned'
              const isAdminRow = role === 'admin'
              const names = teamNamesFor(row.membership, teams)

              return (
                <li key={row.membership.uid} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-medium">{row.displayName}</span>
                      <Badge variant={isAdminRow ? 'default' : 'secondary'}>{ROLE_LABELS[role]}</Badge>
                      {!row.membership.is_active ? <Badge variant="outline">Deactivated</Badge> : null}
                    </div>
                    <p className="text-muted-foreground truncate text-xs">
                      {row.userId} · {summarizeTeamNames(names)}
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setEditing(row)}
                      disabled={busyUid === row.membership.uid}
                    >
                      Edit assignment
                    </Button>

                    {isAdminRow ? (
                      <Button size="sm" variant="ghost" disabled title="Transfer administration first">
                        Deactivate
                      </Button>
                    ) : row.membership.is_active ? (
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button size="sm" variant="ghost" disabled={busyUid === row.membership.uid}>
                            Deactivate
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Deactivate {row.displayName}?</AlertDialogTitle>
                            <AlertDialogDescription>
                              They lose access to this organization and it disappears from their
                              list. Nothing is deleted, and their history stays intact. You can
                              reactivate them here at any time.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={() => toggleActive(row)}>
                              Deactivate
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => toggleActive(row)}
                        disabled={busyUid === row.membership.uid}
                      >
                        Reactivate
                      </Button>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>

      {editing ? (
        <MemberAssignmentDialog
          key={editing.membership.uid}
          membership={editing.membership}
          displayName={editing.displayName}
          teams={teams}
          open
          onOpenChange={(open) => {
            if (!open) setEditing(null)
          }}
          onSaved={async () => {
            await load()
            await refresh()
          }}
        />
      ) : null}
    </Card>
  )
}
