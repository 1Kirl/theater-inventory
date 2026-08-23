import { useState, type FormEvent } from 'react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useOrganization } from '@/features/organizations/useOrganization'
import { createTeam, renameTeam } from '@/services/team-service'
import { toOrganizationErrorMessage } from '@/services/organization-errors-view'

export function TeamsCard() {
  const { organization, teams, refresh } = useOrganization()

  const [newName, setNewName] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleCreate(event: FormEvent) {
    event.preventDefault()
    if (submitting || !organization) return

    setError(null)
    setSubmitting(true)
    try {
      await createTeam({ organizationId: organization.organization_id, name: newName })
      setNewName('')
      await refresh()
    } catch (caught) {
      setError(toOrganizationErrorMessage(caught))
    } finally {
      setSubmitting(false)
    }
  }

  async function handleRename(teamId: string) {
    if (submitting) return

    setError(null)
    setSubmitting(true)
    try {
      await renameTeam({ teamId, name: editingName })
      setEditingId(null)
      await refresh()
    } catch (caught) {
      setError(toOrganizationErrorMessage(caught))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Teams</CardTitle>
        <CardDescription>
          Lighting, Sound, Scenic, and so on. Teams scope who may edit which records, and cannot be
          deleted once created.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {teams.length === 0 ? (
          <p className="text-muted-foreground text-sm">No teams yet. Create the first one below.</p>
        ) : (
          <ul className="divide-border divide-y">
            {teams.map((team) => (
              <li key={team.team_id} className="flex flex-wrap items-center gap-2 py-2">
                {editingId === team.team_id ? (
                  <>
                    <Input
                      value={editingName}
                      onChange={(event) => setEditingName(event.target.value)}
                      maxLength={60}
                      disabled={submitting}
                      className="max-w-56"
                      aria-label={`Rename ${team.name}`}
                    />
                    <Button size="sm" onClick={() => handleRename(team.team_id)} disabled={submitting}>
                      Save
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setEditingId(null)}
                      disabled={submitting}
                    >
                      Cancel
                    </Button>
                  </>
                ) : (
                  <>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{team.name}</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setEditingId(team.team_id)
                        setEditingName(team.name)
                      }}
                      disabled={submitting}
                    >
                      Rename
                    </Button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}

        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <form onSubmit={handleCreate} className="flex flex-wrap gap-2" noValidate>
          <Input
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            placeholder="New team name"
            maxLength={60}
            disabled={submitting}
            className="max-w-56"
            aria-label="New team name"
          />
          <Button type="submit" disabled={submitting || newName.trim().length === 0}>
            {submitting ? 'Saving…' : 'Add team'}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
