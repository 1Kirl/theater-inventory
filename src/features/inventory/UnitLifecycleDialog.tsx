import { useState } from 'react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { assignableTeamIds } from '@/domain/module-access'
import { RETIREMENT_REASONS } from '@/types/inventory'
import { UNIT_STATUS_LABELS } from '@/features/inventory/inventory-unit-view'
import { lifecyclePanel, retirementLabel } from '@/features/inventory/unit-lifecycle-view'
import { useOrganization } from '@/features/organizations/useOrganization'
import { performLifecycleAction } from '@/services/unit-lifecycle-service'
import { membersOfTeam, useTeamMembers } from '@/features/inventory/useTeamMembers'
import { toOrganizationErrorMessage } from '@/services/organization-errors-view'
import type { InventoryUnit, RetirementReason, UnitStatus } from '@/types/inventory'

interface Props {
  unit: InventoryUnit
  /**
   * The move to perform, or `null` to let the user pick one first.
   *
   * The unit page already shows a button per action, so it names the move. The
   * unit list and the edit dialog offer a single "Manage status" control and
   * pass `null`, which turns this into a two-step dialog rather than a second
   * dialog opened on top of the first. Nothing in this project nests modals,
   * and Radix focus traps are the reason.
   */
  to: UnitStatus | null
  label?: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onDone: () => Promise<void> | void
}

/** Radix selects need a non-empty value, and the empty string is not one. */
const UNSET = '__unset__'

/**
 * One lifecycle action, confirmed.
 *
 * Each action asks for exactly what it needs and nothing more: taking equipment
 * out needs to know which crew is getting it, retiring it needs a reason, and
 * checking it in needs nothing at all. A note is always available because
 * "why is this lost" is the question the history will be asked.
 */
export function UnitLifecycleDialog({
  unit, to, label, open, onOpenChange, onDone,
}: Props) {
  const { membership, role, teams } = useOrganization()

  // When the caller did not name a move, the user picks one here first. Built
  // from the same helper the unit page uses, so the three entry points cannot
  // offer different actions.
  const panel = lifecyclePanel({ unit, role, membership })
  const [chosen, setChosen] = useState<{ to: UnitStatus; label: string } | null>(
    to ? { to, label: label ?? '' } : null,
  )
  const move = chosen

  const [usingTeamId, setUsingTeamId] = useState(UNSET)
  const [usingMemberUid, setUsingMemberUid] = useState(UNSET)
  const [retirementReason, setRetirementReason] = useState<RetirementReason>('disposed')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // Naming a borrowing crew is a claim about that crew, so the choices are the
  // teams this person may speak for. Rules check the same thing.
  const assignable = assignableTeamIds(role, membership, teams.map((team) => team.team_id))
  const teamChoices = teams.filter((team) => assignable.includes(team.team_id))

  const needsTeam = move?.to === 'in_use'
  const needsReason = move?.to === 'retired'

  // Shared with the scanner, so both offer the same names under the same rule.
  const members = useTeamMembers({
    organizationId: unit.organization_id,
    enabled: needsTeam,
  })

  const memberChoices = membersOfTeam(members, usingTeamId === UNSET ? null : usingTeamId)

  async function confirm() {
    if (submitting || !move) return
    setError(null)
    setSubmitting(true)

    try {
      await performLifecycleAction({
        unit,
        to: move.to,
        usingTeamId: needsTeam && usingTeamId !== UNSET ? usingTeamId : null,
        usingMemberUid: needsTeam && usingMemberUid !== UNSET ? usingMemberUid : null,
        retirementReason: needsReason ? retirementReason : null,
        note,
      })
      await onDone()
      onOpenChange(false)
    } catch (caught) {
      setError(toOrganizationErrorMessage(caught))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!submitting) onOpenChange(next) }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{move ? move.label : 'Manage status'}</DialogTitle>
          <DialogDescription>
            {move
              ? descriptionFor(move.to, unit.asset_code)
              : `${unit.asset_code} is ${UNIT_STATUS_LABELS[unit.status].toLowerCase()}. What has happened to it?`}
          </DialogDescription>
        </DialogHeader>

        {move === null ? (
          <div className="grid gap-2">
            {panel.actions.length > 0 ? (
              panel.actions.map((option) => (
                <Button
                  key={option.to}
                  variant={option.tone}
                  className="justify-start"
                  onClick={() => setChosen({ to: option.to, label: option.label })}
                >
                  {option.label}
                </Button>
              ))
            ) : (
              <p className="text-muted-foreground text-sm">
                {panel.reason ?? 'Nothing can be done with this unit right now.'}
              </p>
            )}
            {panel.actions.length > 0 && panel.reason ? (
              <p className="text-muted-foreground text-sm">{panel.reason}</p>
            ) : null}
          </div>
        ) : (
        <div className="grid gap-4">
          {needsTeam ? (
            <>
              <div className="space-y-2">
                <Label htmlFor="lifecycle-team">Using team</Label>
                <Select
                  value={usingTeamId}
                  onValueChange={(value) => { setUsingTeamId(value); setUsingMemberUid(UNSET) }}
                  disabled={submitting}
                >
                  <SelectTrigger id="lifecycle-team">
                    <SelectValue placeholder="Which team is taking it?" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={UNSET}>Which team is taking it?</SelectItem>
                    {teamChoices.map((team) => (
                      <SelectItem key={team.team_id} value={team.team_id}>{team.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-muted-foreground text-xs">
                  Who is borrowing it, which need not be the crew that owns it.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="lifecycle-member">Using member (optional)</Label>
                <Select
                  value={usingMemberUid}
                  onValueChange={setUsingMemberUid}
                  disabled={submitting || usingTeamId === UNSET}
                >
                  <SelectTrigger id="lifecycle-member">
                    <SelectValue placeholder="Nobody in particular" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={UNSET}>Nobody in particular</SelectItem>
                    {memberChoices.map((member) => (
                      <SelectItem key={member.uid} value={member.uid}>
                        {member.displayName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </>
          ) : null}

          {needsReason ? (
            <div className="space-y-2">
              <Label htmlFor="lifecycle-reason">Reason</Label>
              <Select
                value={retirementReason}
                onValueChange={(value) => setRetirementReason(value as RetirementReason)}
                disabled={submitting}
              >
                <SelectTrigger id="lifecycle-reason"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {RETIREMENT_REASONS.map((reason) => (
                    <SelectItem key={reason} value={reason}>{retirementLabel(reason)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-muted-foreground text-xs">
                Retiring is permanent. The unit and its history stay, out of the inventory.
              </p>
            </div>
          ) : null}

          <div className="space-y-2">
            <Label htmlFor="lifecycle-note">Note (optional)</Label>
            <Input
              id="lifecycle-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder={to === 'lost' ? 'Where was it last seen?' : 'Anything worth recording'}
              disabled={submitting}
            />
          </div>

          {error ? (
            <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>
          ) : null}
        </div>
        )}

        <DialogFooter>
          {move === null ? (
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          ) : (
            <>
              <Button
                variant="outline"
                // Back to the chooser when the user opened this without naming a
                // move; otherwise there is nothing behind it to go back to.
                onClick={() => (to === null ? setChosen(null) : onOpenChange(false))}
                disabled={submitting}
              >
                {to === null ? 'Back' : 'Cancel'}
              </Button>
              <Button onClick={confirm} disabled={submitting}>
                {submitting ? 'Saving…' : move.label}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function descriptionFor(to: UnitStatus, assetCode: string): string {
  if (to === 'in_use') return `${assetCode} is going out. Say who is taking it.`
  if (to === 'lost') return `${assetCode} cannot be found. It stays in the inventory as missing.`
  if (to === 'retired') return `${assetCode} is leaving the inventory for good.`
  return `${assetCode} is coming back.`
}
