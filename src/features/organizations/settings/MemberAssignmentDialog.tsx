import { useState } from 'react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { satisfiesAssignmentCondition } from '@/domain/effective-role'
import { PERMISSION_LABELS } from '@/domain/organization-view'
import { assignMembership } from '@/services/membership-service'
import { toOrganizationErrorMessage } from '@/services/organization-errors-view'
import {
  PERMISSION_MODULES,
  type ModulePermissions,
  type OrganizationMembership,
  type PermissionLevel,
  type TheaterTeam,
} from '@/types/organization'

const MODULE_LABELS: Record<(typeof PERMISSION_MODULES)[number], string> = {
  inventory: 'Inventory',
  maintenance: 'Maintenance',
  productions: 'Productions',
  calendar: 'Calendar',
}

interface MemberAssignmentDialogProps {
  membership: OrganizationMembership
  displayName: string
  teams: readonly TheaterTeam[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => Promise<void> | void
}

/**
 * Teams and permissions are the only controls. There is no role selector:
 * Member and Unassigned follow from what is set here, and Admin comes from the
 * organization document, not from a membership.
 */
export function MemberAssignmentDialog({
  membership,
  displayName,
  teams,
  open,
  onOpenChange,
  onSaved,
}: MemberAssignmentDialogProps) {
  const [teamIds, setTeamIds] = useState<string[]>(membership.team_ids)
  const [permissions, setPermissions] = useState<ModulePermissions>(membership.permissions)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const willBeMember = satisfiesAssignmentCondition({
    is_active: membership.is_active,
    team_ids: teamIds,
    permissions,
  })

  function toggleTeam(teamId: string) {
    setTeamIds((current) =>
      current.includes(teamId) ? current.filter((id) => id !== teamId) : [...current, teamId],
    )
  }

  async function save() {
    if (submitting) return
    setError(null)
    setSubmitting(true)
    try {
      await assignMembership({
        organizationId: membership.organization_id,
        uid: membership.uid,
        teamIds,
        permissions,
      })
      await onSaved()
      onOpenChange(false)
    } catch (caught) {
      setError(toOrganizationErrorMessage(caught))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="truncate">{displayName}</DialogTitle>
          <DialogDescription>
            Assign teams and module access. A member needs at least one team and at least one module
            above No access.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="space-y-2">
            <Label>Teams</Label>
            {teams.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                No teams exist yet. Create one before assigning members.
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {teams.map((team) => {
                  const selected = teamIds.includes(team.team_id)
                  return (
                    <Button
                      key={team.team_id}
                      type="button"
                      size="sm"
                      variant={selected ? 'default' : 'outline'}
                      onClick={() => toggleTeam(team.team_id)}
                      disabled={submitting}
                      aria-pressed={selected}
                    >
                      {team.name}
                    </Button>
                  )
                })}
              </div>
            )}
          </div>

          <div className="space-y-3">
            <Label>Module permissions</Label>
            {PERMISSION_MODULES.map((module) => (
              <div key={module} className="flex items-center justify-between gap-3">
                <span className="text-sm">{MODULE_LABELS[module]}</span>
                <Select
                  value={permissions[module]}
                  onValueChange={(value) =>
                    setPermissions((current) => ({ ...current, [module]: value as PermissionLevel }))
                  }
                  disabled={submitting}
                >
                  <SelectTrigger className="w-36" aria-label={`${MODULE_LABELS[module]} permission`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(['none', 'view', 'edit'] as const).map((level) => (
                      <SelectItem key={level} value={level}>
                        {PERMISSION_LABELS[level]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))}
            <p className="text-muted-foreground text-xs">
              Action List follows Productions. The Dashboard shows whichever cards these permissions
              allow.
            </p>
          </div>

          <Alert>
            <AlertDescription>
              {willBeMember
                ? 'This assignment makes them a Member.'
                : 'With this assignment they stay Unassigned and cannot open the organization.'}
            </AlertDescription>
          </Alert>

          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={save} disabled={submitting}>
            {submitting ? 'Saving…' : 'Save assignment'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
