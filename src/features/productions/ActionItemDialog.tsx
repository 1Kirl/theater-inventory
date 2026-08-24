import { useState } from 'react'
import { Timestamp } from 'firebase/firestore'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  ACTION_STATUS_LABELS, ACTION_TYPE_LABELS, defaultActionQuantity, type RequirementAvailability,
} from '@/domain/production'
import { saveActionItem } from '@/services/action-item-service'
import { toOrganizationErrorMessage } from '@/services/organization-errors-view'
import {
  ACTION_STATUSES, ACTION_TYPES, type ActionItem, type ActionStatus, type ActionType,
  type ProductionRequirement,
} from '@/types/production'

interface Props {
  requirement: ProductionRequirement
  availability: RequirementAvailability
  existing: ActionItem | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => Promise<void> | void
}

export function ActionItemDialog({
  requirement, availability, existing, open, onOpenChange, onSaved,
}: Props) {
  const [actionType, setActionType] = useState<ActionType>(existing?.action_type ?? 'buy')
  // Defaults to the current shortage at creation, then belongs to the user.
  const [quantity, setQuantity] = useState(
    String(existing?.quantity ?? defaultActionQuantity(availability)),
  )
  const [status, setStatus] = useState<ActionStatus>(existing?.status ?? 'todo')
  const [dueDate, setDueDate] = useState(
    existing?.due_date ? existing.due_date.toDate().toISOString().slice(0, 10) : '',
  )
  const [notes, setNotes] = useState(existing?.notes ?? '')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const currentShortage = availability.matched ? availability.shortage : null
  const diverges = currentShortage !== null && Number(quantity) !== currentShortage

  async function save() {
    if (submitting) return
    setError(null)
    setSubmitting(true)
    try {
      await saveActionItem({
        requirement,
        availability,
        existing,
        input: {
          actionType,
          quantity: Number(quantity),
          status,
          dueDate: dueDate ? Timestamp.fromDate(new Date(`${dueDate}T00:00:00`)) : null,
          notes,
        },
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
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="truncate">{requirement.item_name}</DialogTitle>
          <DialogDescription>
            {existing ? 'Update the planned work.' : 'Plan how this shortage gets covered.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="action-type">Action</Label>
              <Select value={actionType} onValueChange={(v) => setActionType(v as ActionType)} disabled={submitting}>
                <SelectTrigger id="action-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ACTION_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>{ACTION_TYPE_LABELS[type]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="action-qty">Quantity</Label>
              <Input id="action-qty" type="number" min={1} step={1} value={quantity} onChange={(e) => setQuantity(e.target.value)} disabled={submitting} />
            </div>
          </div>

          {currentShortage !== null ? (
            <p className="text-muted-foreground text-sm tabular-nums">
              Current shortage: {currentShortage} · Action quantity: {quantity}
              {diverges ? ' — these differ, which is fine; the action records what you plan to do.' : ''}
            </p>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="action-status">Status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as ActionStatus)} disabled={submitting}>
                <SelectTrigger id="action-status"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ACTION_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>{ACTION_STATUS_LABELS[s]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="action-due">Due date</Label>
              <Input id="action-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} disabled={submitting} />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="action-notes">Notes</Label>
            <textarea id="action-notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} rows={3} disabled={submitting}
              className="border-input bg-transparent focus-visible:ring-ring w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none" />
          </div>

          {error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>Cancel</Button>
          <Button onClick={save} disabled={submitting}>{submitting ? 'Saving…' : 'Save action'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
