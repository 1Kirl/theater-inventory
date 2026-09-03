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
import { nextStartFor, planBulkGeneration } from '@/domain/inventory-unit'
import { createInventoryUnits } from '@/services/inventory-unit-service'
import { toOrganizationErrorMessage } from '@/services/organization-errors-view'
import type { ConditionKey, InventoryItem } from '@/types/inventory'

interface Props {
  item: InventoryItem
  usedCodes: readonly string[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => Promise<void> | void
}

const PREVIEW_LIMIT = 8

/**
 * Create a numbered run of units in one go.
 *
 * The whole run is one transaction, so it either all lands or none of it does.
 * There is no partial batch to explain or clean up.
 */
export function BulkGenerateUnitsDialog({ item, usedCodes, open, onOpenChange, onSaved }: Props) {
  const [prefix, setPrefix] = useState(item.name.slice(0, 8).toUpperCase().replace(/\s+/g, '-'))
  /**
   * Empty means "use the suggestion", which is why this starts empty rather
   * than at '1'.
   *
   * The suggestion follows the prefix, so changing the prefix re-answers the
   * question; anything typed here is kept exactly as typed and is never
   * recomputed underneath the person typing it. Clearing the field hands the
   * decision back rather than falling to zero.
   */
  const [start, setStart] = useState('')
  const [count, setCount] = useState('10')
  const [condition, setCondition] = useState<ConditionKey>('good')
  const [storageLocation, setStorageLocation] = useState(item.location)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const { membership, role, teams } = useOrganization()
  const assignable = assignableTeamIds(role, membership, teams.map((team) => team.team_id))
  const teamChoices = teams.filter((team) => assignable.includes(team.team_id))
  // One team for the whole run. Exceptions are edited afterwards, one unit at a
  // time, which is how they actually come up.
  const [owningTeamId, setOwningTeamId] = useState(item.team_id)

  // One past the highest number already used under this prefix, so a second run
  // does not restart at 1 and collide with the batch already on the shelf.
  const suggestedStart = nextStartFor(prefix, usedCodes)
  const effectiveStart = start.trim() === '' ? suggestedStart : Number(start)

  const plan = planBulkGeneration({
    prefix,
    start: effectiveStart,
    count: Number(count),
    existingCodes: usedCodes,
  })

  async function generate() {
    if (submitting || !plan.valid) return
    setError(null)
    setSubmitting(true)

    try {
      await createInventoryUnits({
        item,
        units: plan.codes.map((assetCode) => ({
          assetCode,
          owningTeamId,
          condition,
          status: 'available' as const,
          storageLocation: storageLocation.trim(),
        })),
        teamIds: assignable,
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
    <Dialog open={open} onOpenChange={(next) => { if (!submitting) onOpenChange(next) }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Generate units</DialogTitle>
          <DialogDescription>
            Create a numbered run of {item.name}. Numbers are padded so they sort and read
            consistently.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2 sm:col-span-1">
              <Label htmlFor="bulk-prefix">Prefix</Label>
              <Input
                id="bulk-prefix"
                value={prefix}
                onChange={(event) => setPrefix(event.target.value)}
                disabled={submitting}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="bulk-start">Start at</Label>
              <Input
                id="bulk-start"
                inputMode="numeric"
                value={start}
                placeholder={String(suggestedStart)}
                onChange={(event) => setStart(event.target.value)}
                disabled={submitting}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="bulk-count">How many</Label>
              <Input
                id="bulk-count"
                inputMode="numeric"
                value={count}
                onChange={(event) => setCount(event.target.value)}
                disabled={submitting}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="bulk-team">Default owning team</Label>
            <Select
              value={owningTeamId}
              onValueChange={setOwningTeamId}
              disabled={submitting || teamChoices.length === 0}
            >
              <SelectTrigger id="bulk-team" className="sm:max-w-xs">
                <SelectValue placeholder="Choose a team" />
              </SelectTrigger>
              <SelectContent>
                {teamChoices.map((team) => (
                  <SelectItem key={team.team_id} value={team.team_id}>{team.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-muted-foreground text-xs">
              Every generated unit starts here. Change the odd one afterwards from its own page.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="bulk-condition">Condition</Label>
              <Select
                value={condition}
                onValueChange={(value) => setCondition(value as ConditionKey)}
                disabled={submitting}
              >
                <SelectTrigger id="bulk-condition"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CONDITION_KEYS.map((key) => (
                    <SelectItem key={key} value={key}>{CONDITION_LABELS[key]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="bulk-location">Storage location</Label>
              <Input
                id="bulk-location"
                value={storageLocation}
                onChange={(event) => setStorageLocation(event.target.value)}
                disabled={submitting}
              />
            </div>
          </div>

          {plan.valid ? (
            <div className="bg-muted/50 space-y-2 rounded-md border p-3">
              <p className="text-sm font-medium">
                {plan.codes.length} unit{plan.codes.length === 1 ? '' : 's'} will be created
              </p>
              <p className="text-muted-foreground font-mono text-xs break-all">
                {plan.codes.slice(0, PREVIEW_LIMIT).join(', ')}
                {plan.codes.length > PREVIEW_LIMIT
                  ? `, … , ${plan.codes[plan.codes.length - 1]}`
                  : ''}
              </p>
              {plan.duplicates.length > 0 ? (
                <p className="text-muted-foreground text-xs">
                  {plan.duplicates.length} of these
                  {plan.duplicates.length === 1 ? ' code is' : ' codes are'} already in use
                  ({plan.duplicates.slice(0, 3).join(', ')}
                  {plan.duplicates.length > 3 ? ', …' : ''}). You can go ahead, but duplicated
                  labels are hard to tell apart on a shelf.
                </p>
              ) : null}
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">{plan.message}</p>
          )}

          {error ? (
            <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={generate} disabled={submitting || !plan.valid}>
            {submitting ? 'Creating…' : `Create ${plan.valid ? plan.codes.length : ''} units`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
