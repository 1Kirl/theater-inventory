import { useState } from 'react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useOrganization } from '@/features/organizations/useOrganization'
import { assignableTeamIds } from '@/domain/module-access'
import { validateRequiredQuantity } from '@/domain/production'
import { createRequirement, updateRequirement } from '@/services/production-requirement-service'
import { toOrganizationErrorMessage } from '@/services/organization-errors-view'
import type { InventoryItem } from '@/types/inventory'
import type { ProductionRequirement } from '@/types/production'

interface Props {
  productionId: string
  existing: ProductionRequirement | null
  items: readonly InventoryItem[]
  canReadInventory: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => Promise<void> | void
}

export function RequirementDialog({
  productionId, existing, items, canReadInventory, open, onOpenChange, onSaved,
}: Props) {
  const { organization, membership, role, teams } = useOrganization()

  const [itemName, setItemName] = useState(existing?.item_name ?? '')
  const [requiredQty, setRequiredQty] = useState(String(existing?.required_qty ?? 1))
  const [teamId, setTeamId] = useState(existing?.team_id ?? '')
  const [inventoryItemId, setInventoryItemId] = useState(existing?.inventory_item_id ?? '')
  const [notes, setNotes] = useState(existing?.notes ?? '')
  const [search, setSearch] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const allowedTeamIds = assignableTeamIds(role, membership, teams.map((t) => t.team_id))
  const teamChoices = teams.filter((team) => allowedTeamIds.includes(team.team_id))

  // The matched item's own team is irrelevant: a sound requirement may match a
  // lighting item. Only the requirement's team governs who may edit it.
  const matches = items
    .filter((item) => {
      const text = search.trim().toLowerCase()
      if (text.length === 0) return true
      return `${item.name} ${item.category}`.toLowerCase().includes(text)
    })
    .slice(0, 40)

  async function save() {
    if (submitting || !organization) return
    setError(null)

    if (itemName.trim().length === 0) {
      setError('Name what the production needs.')
      return
    }
    if (teamId.length === 0) {
      setError('Choose the responsible team.')
      return
    }

    const quantity = validateRequiredQuantity(Number(requiredQty))
    if (!quantity.valid) {
      setError(quantity.message)
      return
    }

    const input = {
      itemName,
      inventoryItemId: inventoryItemId || null,
      requiredQty: Number(requiredQty),
      teamId,
      notes,
    }

    setSubmitting(true)
    try {
      if (existing) {
        await updateRequirement({ existing, input })
      } else {
        await createRequirement({
          organizationId: organization.organization_id, productionId, input,
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
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{existing ? 'Edit requirement' : 'Add requirement'}</DialogTitle>
          <DialogDescription>
            What the production needs, how many, and which crew is responsible.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="req-name">What is needed</Label>
            <Input id="req-name" value={itemName} onChange={(e) => setItemName(e.target.value)} maxLength={120} disabled={submitting} />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="req-qty">Required quantity</Label>
              <Input id="req-qty" type="number" min={1} step={1} value={requiredQty} onChange={(e) => setRequiredQty(e.target.value)} disabled={submitting} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="req-team">Responsible team</Label>
              <Select value={teamId} onValueChange={setTeamId} disabled={submitting}>
                <SelectTrigger id="req-team"><SelectValue placeholder="Choose a team" /></SelectTrigger>
                <SelectContent>
                  {teamChoices.map((team) => (
                    <SelectItem key={team.team_id} value={team.team_id}>{team.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Inventory match</Label>
            {!canReadInventory ? (
              <p className="text-muted-foreground text-sm">
                Matching needs inventory access. You can still record the requirement; it will read
                as Not Matched until someone with inventory access links it.
              </p>
            ) : (
              <>
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search inventory by name or category"
                  disabled={submitting}
                  aria-label="Search inventory"
                />
                <Select
                  value={inventoryItemId || 'none'}
                  onValueChange={(value) => setInventoryItemId(value === 'none' ? '' : value)}
                  disabled={submitting}
                >
                  <SelectTrigger aria-label="Matched inventory item"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Not matched</SelectItem>
                    {matches.map((item) => (
                      <SelectItem key={item.item_id} value={item.item_id}>
                        {item.name} — {item.category} · {item.quantity_available} available
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-muted-foreground text-xs">
                  Any team's inventory may be matched. Shortage is measured against the item's
                  available quantity.
                </p>
              </>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="req-notes">Notes</Label>
            <textarea id="req-notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} rows={3} disabled={submitting}
              className="border-input bg-transparent focus-visible:ring-ring w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none" />
          </div>

          {error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>Cancel</Button>
          <Button onClick={save} disabled={submitting}>{submitting ? 'Saving…' : 'Save requirement'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
