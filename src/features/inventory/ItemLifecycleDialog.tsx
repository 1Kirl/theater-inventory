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
import { itemStatusOf } from '@/domain/inventory'
import { RETIREMENT_REASONS } from '@/types/inventory'
import { UNIT_STATUS_LABELS } from '@/features/inventory/inventory-unit-view'
import { retirementLabel } from '@/features/inventory/unit-lifecycle-view'
import { itemLifecyclePanel } from '@/features/inventory/item-lifecycle-view'
import { useOrganization } from '@/features/organizations/useOrganization'
import { changeItemStatus } from '@/services/item-lifecycle-service'
import { membersOfTeam, useTeamMembers } from '@/features/inventory/useTeamMembers'
import { toOrganizationErrorMessage } from '@/services/organization-errors-view'
import type { InventoryItem, RetirementReason, UnitStatus } from '@/types/inventory'

interface Props {
  item: InventoryItem
  open: boolean
  onOpenChange: (open: boolean) => void
  onDone: () => Promise<void> | void
}

/** Radix selects need a non-empty value, and the empty string is not one. */
const UNSET = '__unset__'

/**
 * Moving a whole bulk item through its life.
 *
 * Deliberately the same dialog as a unit's, one step at a time: pick the move,
 * then answer what that move needs. Building a second lifecycle experience for
 * bulk items would give the product two ways to do one thing.
 *
 * What it is not is a way to move part of the quantity. A bulk item is a
 * quantity nobody counted piece by piece, and this says what happened to the
 * group — the numbers above it go on being maintained by hand.
 */
export function ItemLifecycleDialog({ item, open, onOpenChange, onDone }: Props) {
  const { membership, role, teams } = useOrganization()

  const panel = itemLifecyclePanel({ item, role, membership })
  const [chosen, setChosen] = useState<{ to: UnitStatus; label: string } | null>(null)
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

  const members = useTeamMembers({
    organizationId: item.organization_id,
    enabled: needsTeam,
  })
  const memberChoices = membersOfTeam(members, usingTeamId === UNSET ? null : usingTeamId)

  function close(next: boolean) {
    if (submitting) return
    if (!next) {
      // The chooser is where this dialog starts, so reopening it should not
      // resume halfway through the last move somebody abandoned.
      setChosen(null)
      setError(null)
    }
    onOpenChange(next)
  }

  async function confirm() {
    if (submitting || !move) return
    setError(null)
    setSubmitting(true)

    try {
      await changeItemStatus({
        item,
        to: move.to,
        usingTeamId: needsTeam && usingTeamId !== UNSET ? usingTeamId : null,
        usingMemberUid: needsTeam && usingMemberUid !== UNSET ? usingMemberUid : null,
        retirementReason: needsReason ? retirementReason : null,
        note,
      })
      await onDone()
      setChosen(null)
      onOpenChange(false)
    } catch (caught) {
      setError(toOrganizationErrorMessage(caught))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{move ? move.label : 'Manage status'}</DialogTitle>
          <DialogDescription>
            {move
              ? descriptionFor(move.to, item.name)
              : `${item.name} is ${UNIT_STATUS_LABELS[itemStatusOf(item)].toLowerCase()}. `
                + 'What has happened to it?'}
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
                {panel.reason ?? 'Nothing can be done with this item right now.'}
              </p>
            )}
          </div>
        ) : (
          <div className="grid gap-4">
            {needsTeam ? (
              <>
                <div className="space-y-2">
                  <Label htmlFor="item-lifecycle-team">Using team</Label>
                  <Select
                    value={usingTeamId}
                    onValueChange={(value) => { setUsingTeamId(value); setUsingMemberUid(UNSET) }}
                    disabled={submitting}
                  >
                    <SelectTrigger id="item-lifecycle-team">
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
                  <Label htmlFor="item-lifecycle-member">Using member (optional)</Label>
                  <Select
                    value={usingMemberUid}
                    onValueChange={setUsingMemberUid}
                    disabled={submitting || usingTeamId === UNSET}
                  >
                    <SelectTrigger id="item-lifecycle-member">
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
                <Label htmlFor="item-lifecycle-reason">Reason</Label>
                <Select
                  value={retirementReason}
                  onValueChange={(value) => setRetirementReason(value as RetirementReason)}
                  disabled={submitting}
                >
                  <SelectTrigger id="item-lifecycle-reason"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {RETIREMENT_REASONS.map((reason) => (
                      <SelectItem key={reason} value={reason}>{retirementLabel(reason)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-muted-foreground text-xs">
                  Retiring is permanent. The item and its history stay, out of the inventory.
                </p>
              </div>
            ) : null}

            {move.to === 'in_maintenance' ? (
              <p className="text-muted-foreground text-sm">
                This records that the group has gone for repair. It does not create a repair
                record, and it does not change how many are counted as available.
              </p>
            ) : null}

            <div className="space-y-2">
              <Label htmlFor="item-lifecycle-note">Note (optional)</Label>
              <Input
                id="item-lifecycle-note"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder={move.to === 'lost' ? 'Where was it last seen?' : 'Anything worth recording'}
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
            <Button variant="outline" onClick={() => close(false)}>Cancel</Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => setChosen(null)} disabled={submitting}>
                Back
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

function descriptionFor(to: UnitStatus, name: string): string {
  if (to === 'in_use') return `${name} is going out. Say which team is taking it.`
  if (to === 'in_maintenance') return `${name} is going for repair.`
  if (to === 'lost') return `${name} cannot be found. It stays in the inventory as missing.`
  if (to === 'retired') return `${name} is leaving the inventory for good.`
  return `${name} is coming back.`
}
