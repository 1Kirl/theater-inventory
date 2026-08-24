import { useMemo, useState } from 'react'
import { Sparkles, Trash2 } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useOrganization } from '@/features/organizations/useOrganization'
import { assignableTeamIds } from '@/domain/module-access'
import { aiFailureMessage } from '@/features/ai/ai-errors'
import { reportAiFailure } from '@/features/ai/ai-diagnostics'
import {
  buildSuggestionDrafts, draftBlocker, draftFacts, isSavable, toRequirementInputs,
  type SuggestionDraft,
} from '@/features/ai/requirement-generator'
import {
  MAX_PROMPT_LENGTH, generateRequirementDraft,
} from '@/features/ai/requirement-generator-service'
import { ACTION_TYPE_LABELS } from '@/domain/production'
import { createRequirement } from '@/services/production-requirement-service'
import { toOrganizationErrorMessage } from '@/services/organization-errors-view'
import type { InventoryItem } from '@/types/inventory'
import type { Production } from '@/types/production'

/**
 * The review step AI_SPEC section 4.6 requires.
 *
 * Generation produces rows, not records. Every row starts unaccepted, and the
 * save button writes only the rows a person ticked and left in a savable state.
 * A suggestion that names a team the reviewer may not write to cannot be
 * accepted at all — Security Rules would refuse it, and asking here is kinder
 * than failing at save.
 */

interface Props {
  production: Production
  items: readonly InventoryItem[]
  canReadInventory: boolean
  existingItemNames: readonly string[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => Promise<void> | void
}

const NO_MATCH = 'none'

export function RequirementGeneratorDialog({
  production, items, canReadInventory, existingItemNames, open, onOpenChange, onSaved,
}: Props) {
  const { organization, membership, role, teams } = useOrganization()

  const [prompt, setPrompt] = useState('')
  const [drafts, setDrafts] = useState<SuggestionDraft[] | null>(null)
  const [assessment, setAssessment] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saveResult, setSaveResult] = useState<string | null>(null)

  const allowedTeamIds = useMemo(
    () => assignableTeamIds(role, membership, teams.map((team) => team.team_id)),
    [role, membership, teams],
  )
  const teamChoices = teams.filter((team) => allowedTeamIds.includes(team.team_id))

  const savable = drafts?.filter((draft) => isSavable(draft, allowedTeamIds)) ?? []

  function update(key: string, patch: Partial<SuggestionDraft>) {
    setDrafts((current) =>
      current?.map((draft) => (draft.key === key ? { ...draft, ...patch } : draft)) ?? null,
    )
  }

  function remove(key: string) {
    setDrafts((current) => current?.filter((draft) => draft.key !== key) ?? null)
  }

  async function generate() {
    if (generating || saving) return
    setError(null)
    setSaveResult(null)
    setNotice(null)
    setGenerating(true)

    try {
      const outcome = await generateRequirementDraft({
        production,
        teams,
        existingItemNames,
        userPrompt: prompt,
        // Matching and inventory-aware advice both need inventory access;
        // without it nothing is read and the draft is general guidance.
        items: canReadInventory ? items : [],
        canReadInventory,
      })

      setAssessment(outcome.summary || null)
      setDrafts(
        buildSuggestionDrafts(outcome.suggestions, {
          teams,
          allowedTeamIds,
          items: canReadInventory ? items : [],
          inventoryContext: outcome.context,
        }),
      )

      const notices: string[] = []
      if (outcome.discardedCount > 0) {
        notices.push(
          `${outcome.discardedCount} suggestion${outcome.discardedCount === 1 ? '' : 's'} could not be interpreted and ${outcome.discardedCount === 1 ? 'was' : 'were'} dropped.`,
        )
      }
      if (outcome.truncated) {
        notices.push('The AI answer was cut short, so the draft may be incomplete.')
      }
      if (outcome.context.omittedCount > 0) {
        notices.push(
          `${outcome.context.omittedCount} inventory records did not fit in the request, so the assessment may not account for them.`,
        )
      }
      setNotice(notices.length > 0 ? notices.join(' ') : null)
    } catch (caught) {
      // The message on screen stays deliberately vague; the console gets the
      // sanitized detail, in development only.
      reportAiFailure(caught, 'requirement-generator')
      setError(aiFailureMessage(caught))
    } finally {
      setGenerating(false)
    }
  }

  async function save() {
    if (saving || generating || !organization || !drafts) return
    setError(null)

    const inputs = toRequirementInputs(drafts, allowedTeamIds)
    if (inputs.length === 0) return

    setSaving(true)
    try {
      for (const input of inputs) {
        await createRequirement({
          organizationId: organization.organization_id,
          productionId: production.production_id,
          input,
          // Recorded as approved by a person, which is the only way a
          // suggestion ever reaches Firestore.
          source: 'ai_approved',
        })
      }

      await onSaved()
      setSaveResult(`Added ${inputs.length} requirement${inputs.length === 1 ? '' : 's'}.`)
      setDrafts((current) => current?.filter((draft) => !isSavable(draft, allowedTeamIds)) ?? null)
    } catch (caught) {
      setError(toOrganizationErrorMessage(caught))
    } finally {
      setSaving(false)
    }
  }

  function DraftRow({ draft }: { draft: SuggestionDraft }) {
    const blocker = draftBlocker(draft, allowedTeamIds)
    const busy = generating || saving
    // Availability and shortage are read from the real record and recomputed on
    // every edit. Whatever the AI said in its prose, these are the numbers.
    const facts = draftFacts(draft, items)

    return (
      <li className="border-border space-y-3 rounded-md border p-3">
        <div className="flex items-start justify-between gap-2">
          <label className="flex min-w-0 flex-1 items-start gap-2">
            <input
              type="checkbox"
              className="mt-1 size-4 shrink-0"
              checked={draft.accepted}
              disabled={busy || blocker !== null}
              onChange={(event) => update(draft.key, { accepted: event.target.checked })}
              aria-label={`Accept ${draft.itemName}`}
            />
            <span className="min-w-0 flex-1 text-sm font-medium">{draft.itemName}</span>
          </label>
          <Button
            variant="ghost"
            size="icon"
            className="size-8 shrink-0"
            onClick={() => remove(draft.key)}
            disabled={busy}
            aria-label={`Remove ${draft.itemName}`}
          >
            <Trash2 className="size-4" aria-hidden="true" />
          </Button>
        </div>

        <div className="text-muted-foreground space-y-1 text-xs">
          <p>AI recommends: {draft.requiredQty}</p>
          {facts.matched ? (
            <p className="tabular-nums">
              Matched inventory: {facts.matched.name} · Available {facts.available} · Calculated
              shortage {facts.shortage}
              <span className="ml-1 not-italic">(calculated by the app)</span>
            </p>
          ) : (
            <p>Not matched to inventory, so no shortage is calculated.</p>
          )}
          {draft.notes ? <p className="italic">Reason: {draft.notes}</p> : null}
          {draft.suggestedAction ? (
            <p>
              AI suggests: {ACTION_TYPE_LABELS[draft.suggestedAction]}. Advice only — plan the
              action from the requirements table after saving.
            </p>
          ) : null}
          {draft.refWasUnknown ? (
            <p>The AI pointed at an item that was not in its list, so it was left unmatched.</p>
          ) : null}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-xs">What is needed</Label>
            <Input
              value={draft.itemName}
              onChange={(event) => update(draft.key, { itemName: event.target.value })}
              maxLength={120}
              disabled={busy}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Required quantity</Label>
            <Input
              type="number"
              min={1}
              step={1}
              value={draft.requiredQty}
              onChange={(event) => update(draft.key, { requiredQty: Number(event.target.value) })}
              disabled={busy}
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Responsible team</Label>
          <Select
            value={draft.teamId ?? ''}
            onValueChange={(value) => update(draft.key, { teamId: value })}
            disabled={busy}
          >
            <SelectTrigger><SelectValue placeholder="Choose a team" /></SelectTrigger>
            <SelectContent>
              {teamChoices.map((team) => (
                <SelectItem key={team.team_id} value={team.team_id}>{team.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {draft.teamResolution === 'unknown-team' && draft.suggestedTeamName ? (
            <p className="text-muted-foreground text-xs">
              The AI suggested "{draft.suggestedTeamName}", which is not a team here. Pick one.
            </p>
          ) : null}
          {draft.teamResolution === 'not-allowed' && draft.suggestedTeamName ? (
            <p className="text-muted-foreground text-xs">
              The AI suggested "{draft.suggestedTeamName}", which you cannot save requirements for.
              Pick one of your own teams.
            </p>
          ) : null}
          {draft.teamResolution === 'none' ? (
            <p className="text-muted-foreground text-xs">
              The AI did not suggest a team. Pick the crew responsible.
            </p>
          ) : null}
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Inventory match</Label>
          {!canReadInventory ? (
            <p className="text-muted-foreground text-xs">
              Matching needs inventory access. This will save as Not Matched.
            </p>
          ) : (
            <>
              <Select
                value={draft.inventoryItemId ?? NO_MATCH}
                onValueChange={(value) =>
                  update(draft.key, { inventoryItemId: value === NO_MATCH ? null : value })
                }
                disabled={busy}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_MATCH}>Not matched</SelectItem>
                  {draft.candidates.map((item) => (
                    <SelectItem key={item.item_id} value={item.item_id}>
                      {item.name} — {item.category} · {item.quantity_available} available
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-muted-foreground text-xs">
                {draft.candidates.length === 0
                  ? draft.matchKeyword
                    ? `Nothing in inventory matched "${draft.matchKeyword}". It will save as Not Matched.`
                    : 'No inventory candidates were found. It will save as Not Matched.'
                  : draft.inventoryItemId
                    ? 'Matched on an exact name. Change it if that is the wrong item.'
                    : 'Candidates found from real inventory. Pick one, or leave it unmatched.'}
              </p>
            </>
          )}
        </div>

        {blocker === 'team' ? (
          <Badge variant="outline">Choose a team before accepting</Badge>
        ) : null}
        {blocker === 'quantity' ? (
          <Badge variant="outline">Quantity must be a whole number of 1 or more</Badge>
        ) : null}
        {blocker === 'name' ? <Badge variant="outline">Give it a name</Badge> : null}
      </li>
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-4" aria-hidden="true" />
            Draft requirements with AI
          </DialogTitle>
          <DialogDescription>
            The AI reads the inventory you already have access to and drafts against it.
            Suggestions only — nothing is saved until you accept it, and every quantity, team, and
            inventory match is yours to correct.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="gen-prompt">What should it plan for?</Label>
            <textarea
              id="gen-prompt"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              maxLength={MAX_PROMPT_LENGTH}
              rows={3}
              disabled={generating || saving}
              placeholder="e.g. school musical in a 200-seat auditorium, 20 performers, live vocals, two rehearsal days"
              className="border-input bg-transparent focus-visible:ring-ring w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none"
            />
            <p className="text-muted-foreground text-xs">
              The production's title and description are included automatically. Nothing about
              members or accounts is sent.
            </p>
          </div>

          <Button onClick={generate} disabled={generating || saving}>
            {generating ? 'Drafting…' : drafts ? 'Regenerate' : 'Generate suggestions'}
          </Button>

          {error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}
          {saveResult ? <Alert><AlertDescription>{saveResult}</AlertDescription></Alert> : null}

          {drafts && drafts.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Nothing left to review. Generate again, or close and add requirements by hand.
            </p>
          ) : null}

          {assessment ? (
            <div className="bg-muted/50 space-y-2 rounded-md p-3">
              <p className="text-sm font-medium">AI assessment</p>
              <p className="text-sm whitespace-pre-wrap">{assessment}</p>
              {!canReadInventory ? (
                <p className="text-muted-foreground text-xs">
                  General guidance only. You do not have inventory access, so nothing was read and
                  the AI knows nothing about what this organization already owns.
                </p>
              ) : null}
            </div>
          ) : null}

          {notice ? <Alert><AlertDescription>{notice}</AlertDescription></Alert> : null}

          {drafts && drafts.length > 0 ? (
            <div className="space-y-3">
              <p className="text-muted-foreground text-xs">
                {savable.length} of {drafts.length} ready to add.
              </p>
              <ul className="space-y-3">
                {drafts.map((draft) => (
                  <DraftRow key={draft.key} draft={draft} />
                ))}
              </ul>
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={generating || saving}>
            Close
          </Button>
          <Button onClick={save} disabled={saving || generating || savable.length === 0}>
            {saving ? 'Adding…' : `Add ${savable.length} selected requirement${savable.length === 1 ? '' : 's'}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
