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
import {
  PROMOTION_STATUSES, buildPromotionDrafts, draftsMissingUsingTeam, promotionOutcome,
  unclassifiedDraftCount, validatePromotion,
  type PromotionDraft,
} from '@/domain/inventory-unit'
import { assignableTeamIds } from '@/domain/module-access'
import { useOrganization } from '@/features/organizations/useOrganization'
import { UNIT_STATUS_LABELS } from '@/features/inventory/inventory-unit-view'
import { promoteToSerialized } from '@/services/inventory-unit-service'
import { toOrganizationErrorMessage } from '@/services/organization-errors-view'
import type { ConditionKey, InventoryItem, UnitStatus } from '@/types/inventory'

interface Props {
  item: InventoryItem
  open: boolean
  onOpenChange: (open: boolean) => void
  onConverted: () => Promise<void> | void
}

type Step = 'codes' | 'review'

/** Radix selects need a non-empty value, and the empty string is not one. */
const UNSET = '__unset__'

/**
 * Convert a bulk item into individually tracked units.
 *
 * The conversion is one-way and nothing about it is guessed. A bulk item knows
 * it has twelve of something and that eight are available; it does not know
 * where the other four are, and it may not even know what condition all twelve
 * are in — `sum(condition_counts) <= quantity_total` is legal for a bulk item
 * and impossible for a serialized one.
 *
 * So the review step is one the user cannot skip past. Every unit the aggregate
 * never classified has to be given a condition, and every unit marked as out has
 * to name the team that has it. Until both hold, Convert stays disabled: a
 * serialized summary is only worth having if it describes units somebody
 * actually looked at.
 */
export function PromoteToSerializedDialog({ item, open, onOpenChange, onConverted }: Props) {
  const [step, setStep] = useState<Step>('codes')
  const [prefix, setPrefix] = useState(item.name.slice(0, 8).toUpperCase().replace(/\s+/g, '-'))
  const [start, setStart] = useState('1')
  const [drafts, setDrafts] = useState<PromotionDraft[]>([])
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const { membership, role, teams } = useOrganization()
  // Only teams this person could hand a unit to; Rules test the same thing.
  const assignable = assignableTeamIds(role, membership, teams.map((team) => team.team_id))
  const owningChoices = teams.filter((team) => assignable.includes(team.team_id))

  // Validated against what this person may actually assign, which is what the
  // service will check and what Rules will enforce.
  const validation = validatePromotion({ item, drafts, teamIds: assignable })
  const unclassified = unclassifiedDraftCount(drafts)
  const missingTeam = draftsMissingUsingTeam(drafts)

  // Only meaningful once every unit is settled. Before that these numbers would
  // preview something the user has not finished describing. Not memoized:
  // `validation` is rebuilt every render anyway, so a dependency on it would
  // memoize nothing, and folding a couple of hundred drafts is not the cost.
  const outcome = validation.valid ? promotionOutcome({ item, drafts: validation.drafts }) : null

  function toReview() {
    setError(null)
    const built = buildPromotionDrafts({ item, prefix, start: Number(start) })
    if (built.length === 0) {
      setError('There is nothing to convert: this item has no quantity.')
      return
    }
    // Unclassified units and missing teams are what the review step exists to
    // resolve, so they are not a reason to refuse to open it.
    setDrafts(built)
    setStep('review')
  }

  function setDraft(index: number, patch: Partial<PromotionDraft>) {
    setDrafts((current) => current.map(
      (draft, at) => (at === index ? { ...draft, ...patch } : draft),
    ))
  }

  async function convert() {
    if (submitting || !validation.valid) return
    setError(null)
    setSubmitting(true)

    try {
      await promoteToSerialized({ item, drafts, teamIds: assignable })
      await onConverted()
      onOpenChange(false)
    } catch (caught) {
      // The conversion is one transaction, so a failure changed nothing: the
      // item is still a bulk quantity with its original numbers.
      setError(
        `${toOrganizationErrorMessage(caught)} Nothing was converted — this item is still `
        + 'tracked as a bulk quantity.',
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!submitting) onOpenChange(next) }}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Track {item.name} as individual equipment</DialogTitle>
          <DialogDescription>
            {step === 'codes'
              ? `This creates one unit for each of the ${item.quantity_total} recorded, all at once. It cannot be undone.`
              : 'Say what each unit actually is. Nothing has been written yet.'}
          </DialogDescription>
        </DialogHeader>

        {step === 'codes' ? (
          <div className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="promote-prefix">Asset code prefix</Label>
                <Input
                  id="promote-prefix"
                  value={prefix}
                  onChange={(event) => setPrefix(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="promote-start">Start at</Label>
                <Input
                  id="promote-start"
                  inputMode="numeric"
                  value={start}
                  onChange={(event) => setStart(event.target.value)}
                />
              </div>
            </div>
            <Alert>
              <AlertDescription>
                Once converted, this item&rsquo;s totals are counted from its units, and each unit
                carries its own owning team. There is no way back to a bulk quantity.
              </AlertDescription>
            </Alert>
            <Alert>
              <AlertDescription>
                Equipment that is away for repair cannot be described here yet — a unit in
                maintenance needs the repair record that goes with it, and that arrives in a
                later release. Convert it as available or in use for now, whichever is closer to
                the truth, and record the repair once repairs work unit by unit.
              </AlertDescription>
            </Alert>
            {error ? (
              <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>
            ) : null}
          </div>
        ) : (
          <div className="grid gap-4">
            <div className="max-h-[45vh] space-y-2 overflow-y-auto pr-1">
              {drafts.map((draft, index) => (
                <div
                  key={draft.assetCode + String(index)}
                  className={`space-y-2 rounded-md border p-2 ${
                    draft.condition === null ? 'border-destructive/50 bg-destructive/5' : ''
                  }`}
                >
                  <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_9rem_10rem] sm:items-center">
                    <p className="font-mono text-sm">{draft.assetCode}</p>

                    <Select
                      value={draft.condition ?? UNSET}
                      onValueChange={(value) => setDraft(index, {
                        condition: value === UNSET ? null : (value as ConditionKey),
                      })}
                      disabled={submitting}
                    >
                      <SelectTrigger aria-label={`Condition of ${draft.assetCode}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={UNSET}>Not classified</SelectItem>
                        {CONDITION_KEYS.map((key) => (
                          <SelectItem key={key} value={key}>{CONDITION_LABELS[key]}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    <Select
                      value={draft.status}
                      onValueChange={(value) => setDraft(index, {
                        status: value as UnitStatus,
                        // Dropping the team alongside the status keeps the two
                        // from disagreeing while the user is still deciding.
                        ...(value === 'in_use' ? {} : { usingTeamId: null }),
                      })}
                      disabled={submitting}
                    >
                      <SelectTrigger aria-label={`Status of ${draft.assetCode}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PROMOTION_STATUSES.map((status) => (
                          <SelectItem key={status} value={status}>
                            {UNIT_STATUS_LABELS[status]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="grid gap-2 sm:grid-cols-2">
                    <Select
                      value={draft.owningTeamId}
                      onValueChange={(value) => setDraft(index, { owningTeamId: value })}
                      disabled={submitting}
                    >
                      <SelectTrigger aria-label={`Owning team of ${draft.assetCode}`}>
                        <SelectValue placeholder="Owned by" />
                      </SelectTrigger>
                      <SelectContent>
                        {owningChoices.map((team) => (
                          <SelectItem key={team.team_id} value={team.team_id}>
                            Owned by {team.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    {draft.status === 'in_use' ? (
                    <Select
                      value={draft.usingTeamId ?? UNSET}
                      onValueChange={(value) => setDraft(index, {
                        usingTeamId: value === UNSET ? null : value,
                      })}
                      disabled={submitting}
                    >
                      <SelectTrigger
                        aria-label={`Team using ${draft.assetCode}`}
                        className="sm:max-w-xs"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={UNSET}>Which team has it?</SelectItem>
                        {teams.map((team) => (
                          <SelectItem key={team.team_id} value={team.team_id}>
                            {team.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>

            {unclassified > 0 ? (
              <Alert variant="destructive">
                <AlertDescription>
                  {unclassified} unit{unclassified === 1 ? ' does' : 's do'} not have an existing
                  condition classification. Assign a condition before converting this item.
                </AlertDescription>
              </Alert>
            ) : null}

            {missingTeam > 0 ? (
              <Alert variant="destructive">
                <AlertDescription>
                  {missingTeam} unit{missingTeam === 1 ? '' : 's'} marked in use
                  {missingTeam === 1 ? ' does' : ' do'} not say which team has
                  {missingTeam === 1 ? ' it' : ' them'}. Choose a team for each.
                </AlertDescription>
              </Alert>
            ) : null}

            {outcome === null ? null : outcome.changed ? (
              <Alert>
                <AlertDescription>
                  Available will change from {outcome.previousAvailable} to {outcome.nextAvailable}.
                  {outcome.mirrors.unit_counts.unusable_on_hand > 0
                    ? ' Unusable units stay in the total but no longer count as available.'
                    : ''}
                </AlertDescription>
              </Alert>
            ) : (
              <p className="text-muted-foreground text-sm">
                Available stays at {outcome.nextAvailable}.
              </p>
            )}

            {error ? (
              <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>
            ) : null}
          </div>
        )}

        <DialogFooter>
          {step === 'codes' ? (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button onClick={toReview}>Review {item.quantity_total} units</Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => setStep('codes')} disabled={submitting}>
                Back
              </Button>
              <Button onClick={convert} disabled={submitting || !validation.valid}>
                {submitting ? 'Converting…' : 'Convert'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
