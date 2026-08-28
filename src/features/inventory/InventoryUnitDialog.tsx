import { useState } from 'react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { CONDITION_KEYS, CONDITION_LABELS } from '@/domain/inventory'
import { assignableTeamIds } from '@/domain/module-access'
import { useOrganization } from '@/features/organizations/useOrganization'
import { UNIT_STATUS_LABELS } from '@/features/inventory/inventory-unit-view'
import { createInventoryUnit, updateInventoryUnit } from '@/services/inventory-unit-service'
import { toOrganizationErrorMessage } from '@/services/organization-errors-view'
import type {
  ConditionKey, InventoryItem, InventoryUnit, UnitStatus,
} from '@/types/inventory'

/** Radix selects need a non-empty value, and the empty string is not one. */
const UNSET = '__unset__'

/** What a newly registered asset may already be. Mirrors the service. */
const CREATABLE_STATUSES: readonly UnitStatus[] = ['available', 'in_use', 'lost']

interface Props {
  item: InventoryItem
  existing: InventoryUnit | null
  /** Codes already used, so a collision can be pointed out before saving. */
  usedCodes: readonly string[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => Promise<void> | void
}

/**
 * Add or edit one unit.
 *
 * Lifecycle status is shown but never editable. Checking equipment out, sending
 * it for repair, and retiring it are operations with their own consequences, and
 * a dropdown here would let someone move a unit between them without any of the
 * accompanying record. New units start Available for the same reason: this
 * phase has no way to record why anything would start anywhere else.
 */
export function InventoryUnitDialog({
  item, existing, usedCodes, open, onOpenChange, onSaved,
}: Props) {
  const [assetCode, setAssetCode] = useState(existing?.asset_code ?? '')
  const [condition, setCondition] = useState<ConditionKey>(existing?.condition ?? 'good')
  const [storageLocation, setStorageLocation] = useState(
    existing?.storage_location ?? item.location,
  )
  const [notes, setNotes] = useState(existing?.notes ?? '')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const { membership, role, teams } = useOrganization()
  // Teams this person may hand a unit to. Rules check the same thing at both
  // ends of a move, so offering more than this would only produce a denial.
  const assignable = assignableTeamIds(role, membership, teams.map((team) => team.team_id))
  const teamChoices = teams.filter((team) => assignable.includes(team.team_id))

  // A new unit starts where the item does, which is information rather than a
  // guess; an existing one keeps its own.
  const [owningTeamId, setOwningTeamId] = useState(existing?.team_id ?? item.team_id)
  // Registering an asset is not the same as acquiring one: it may already be
  // out with a crew, or already missing.
  const [status, setStatus] = useState<UnitStatus>('available')
  const [usingTeamId, setUsingTeamId] = useState(UNSET)

  const trimmed = assetCode.trim()
  const duplicate = trimmed.length > 0 && usedCodes.some(
    (code) => code.toLowerCase() === trimmed.toLowerCase() && code !== existing?.asset_code,
  )

  async function save() {
    if (submitting) return
    setError(null)

    if (trimmed.length === 0) {
      setError('Give the unit an asset code — it is how people tell one from another.')
      return
    }
    if (storageLocation.trim().length === 0) {
      setError('Say where this unit is stored.')
      return
    }
    if (!existing && status === 'in_use' && usingTeamId === UNSET) {
      setError('Say which team has this unit.')
      return
    }

    setSubmitting(true)
    try {
      if (existing) {
        await updateInventoryUnit({
          existing,
          input: {
            assetCode: trimmed,
            owningTeamId,
            condition,
            storageLocation: storageLocation.trim(),
            notes,
          },
          teamIds: assignable,
        })
      } else {
        await createInventoryUnit({
          item,
          input: {
            assetCode: trimmed,
            owningTeamId,
            condition,
            // New units are on the shelf. Nothing else is recordable yet.
            status,
            usingTeamId: status === 'in_use' && usingTeamId !== UNSET ? usingTeamId : null,
            storageLocation: storageLocation.trim(),
            notes,
          },
          teamIds: assignable,
        })
      }
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
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{existing ? 'Edit unit' : 'Add a unit'}</DialogTitle>
          <DialogDescription>
            {existing
              ? 'The item totals follow whatever you record here.'
              : `One physical piece of ${item.name}.`}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="space-y-2">
            <Label htmlFor="unit-asset-code">Asset code</Label>
            <Input
              id="unit-asset-code"
              value={assetCode}
              onChange={(event) => setAssetCode(event.target.value)}
              placeholder="MIC-004"
              disabled={submitting}
            />
            {duplicate ? (
              <p className="text-muted-foreground text-xs">
                Another unit already uses this code. That is allowed — codes are labels, not
                identity — but it will be harder to tell them apart.
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="unit-team">Owning team</Label>
            <Select
              value={owningTeamId}
              onValueChange={setOwningTeamId}
              disabled={submitting || teamChoices.length === 0}
            >
              <SelectTrigger id="unit-team"><SelectValue placeholder="Choose a team" /></SelectTrigger>
              <SelectContent>
                {teamChoices.map((team) => (
                  <SelectItem key={team.team_id} value={team.team_id}>{team.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-muted-foreground text-xs">
              Units of one item can belong to different crews. This one is yours to move only
              between teams you can edit for.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="unit-condition">Condition</Label>
            <Select
              value={condition}
              onValueChange={(value) => setCondition(value as ConditionKey)}
              disabled={submitting}
            >
              <SelectTrigger id="unit-condition"><SelectValue /></SelectTrigger>
              <SelectContent>
                {CONDITION_KEYS.map((key) => (
                  <SelectItem key={key} value={key}>{CONDITION_LABELS[key]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {condition === 'unusable' ? (
              <p className="text-muted-foreground text-xs">
                An unusable unit stays in the total but stops counting as available.
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="unit-location">Storage location</Label>
            <Input
              id="unit-location"
              value={storageLocation}
              onChange={(event) => setStorageLocation(event.target.value)}
              disabled={submitting}
            />
          </div>

          {existing ? (
            <div className="space-y-1">
              <Label>Status</Label>
              <p className="text-sm">{UNIT_STATUS_LABELS[existing.status]}</p>
              <p className="text-muted-foreground text-xs">
                Status changes with what happens to the equipment, not by editing this form. Use
                the actions on the unit&rsquo;s own page.
              </p>
            </div>
          ) : (
            <>
              <div className="space-y-2">
                <Label htmlFor="unit-status">Where is it now?</Label>
                <Select
                  value={status}
                  onValueChange={(value) => setStatus(value as UnitStatus)}
                  disabled={submitting}
                >
                  <SelectTrigger id="unit-status"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CREATABLE_STATUSES.map((option) => (
                      <SelectItem key={option} value={option}>
                        {UNIT_STATUS_LABELS[option]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-muted-foreground text-xs">
                  Equipment being added may already be out or already missing. Repairs and
                  retirement come from what happens to it later.
                </p>
              </div>

              {status === 'in_use' ? (
                <div className="space-y-2">
                  <Label htmlFor="unit-using-team">Using team</Label>
                  <Select
                    value={usingTeamId}
                    onValueChange={setUsingTeamId}
                    disabled={submitting}
                  >
                    <SelectTrigger id="unit-using-team">
                      <SelectValue placeholder="Which team has it?" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={UNSET}>Which team has it?</SelectItem>
                      {teamChoices.map((team) => (
                        <SelectItem key={team.team_id} value={team.team_id}>{team.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}
            </>
          )}

          <div className="space-y-2">
            <Label htmlFor="unit-notes">Notes</Label>
            <Input
              id="unit-notes"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Optional"
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
          <Button onClick={save} disabled={submitting}>
            {submitting ? 'Saving…' : existing ? 'Save unit' : 'Add unit'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
