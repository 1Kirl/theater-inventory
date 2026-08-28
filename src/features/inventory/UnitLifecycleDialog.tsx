import { useEffect, useState } from 'react'
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
import { retirementLabel } from '@/features/inventory/unit-lifecycle-view'
import { useOrganization } from '@/features/organizations/useOrganization'
import { performLifecycleAction } from '@/services/unit-lifecycle-service'
import { listOrganizationDirectory } from '@/services/membership-service'
import { getUserProfiles } from '@/services/user-service'
import { toOrganizationErrorMessage } from '@/services/organization-errors-view'
import type { InventoryUnit, RetirementReason, UnitStatus } from '@/types/inventory'

interface Props {
  unit: InventoryUnit
  to: UnitStatus
  label: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onDone: () => Promise<void> | void
}

/** Radix selects need a non-empty value, and the empty string is not one. */
const UNSET = '__unset__'

interface MemberOption {
  uid: string
  displayName: string
  teamIds: string[]
}

/**
 * One lifecycle action, confirmed.
 *
 * Each action asks for exactly what it needs and nothing more: taking equipment
 * out needs to know which crew is getting it, retiring it needs a reason, and
 * checking it in needs nothing at all. A note is always available because
 * "why is this lost" is the question the history will be asked.
 */
export function UnitLifecycleDialog({ unit, to, label, open, onOpenChange, onDone }: Props) {
  const { membership, role, teams } = useOrganization()

  const [usingTeamId, setUsingTeamId] = useState(UNSET)
  const [usingMemberUid, setUsingMemberUid] = useState(UNSET)
  const [retirementReason, setRetirementReason] = useState<RetirementReason>('disposed')
  const [note, setNote] = useState('')
  const [members, setMembers] = useState<MemberOption[]>([])
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // Naming a borrowing crew is a claim about that crew, so the choices are the
  // teams this person may speak for. Rules check the same thing.
  const assignable = assignableTeamIds(role, membership, teams.map((team) => team.team_id))
  const teamChoices = teams.filter((team) => assignable.includes(team.team_id))

  const needsTeam = to === 'in_use'
  const needsReason = to === 'retired'

  useEffect(() => {
    if (!needsTeam || !unit.organization_id) return

    let cancelled = false
    async function read() {
      const directory = await listOrganizationDirectory(unit.organization_id)
      const profiles = await getUserProfiles(directory.map((entry) => entry.uid))

      return directory.map((entry) => ({
        uid: entry.uid,
        displayName: profiles.get(entry.uid)?.display_name ?? 'Unknown member',
        teamIds: entry.team_ids,
      }))
    }

    read().then(
      (loaded) => { if (!cancelled) setMembers(loaded) },
      // The member is optional, so failing to list them is not worth an error.
      () => { if (!cancelled) setMembers([]) },
    )

    return () => { cancelled = true }
  }, [needsTeam, unit.organization_id])

  // Only people actually on the borrowing crew, once one is chosen.
  const memberChoices = usingTeamId === UNSET
    ? []
    : members.filter((member) => member.teamIds.includes(usingTeamId))

  async function confirm() {
    if (submitting) return
    setError(null)
    setSubmitting(true)

    try {
      await performLifecycleAction({
        unit,
        to,
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
          <DialogTitle>{label}</DialogTitle>
          <DialogDescription>{descriptionFor(to, unit.asset_code)}</DialogDescription>
        </DialogHeader>

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

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={confirm} disabled={submitting}>
            {submitting ? 'Saving…' : label}
          </Button>
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
