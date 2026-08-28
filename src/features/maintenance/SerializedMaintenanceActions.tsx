import { useState } from 'react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { MAINTENANCE_STATUS_LABELS } from '@/domain/maintenance'
import {
  SERIALIZED_ACTIVE_STATUSES, isPlannedMaintenance, maintenanceWorkflowSteps,
} from '@/domain/unit-maintenance'
import {
  cancelMaintenancePlan, startPlannedMaintenance, updateSerializedMaintenance,
} from '@/services/unit-maintenance-service'
import { toOrganizationErrorMessage } from '@/services/organization-errors-view'
import type { MaintenanceRecord, MaintenanceStatus } from '@/types/maintenance'

interface Props {
  record: MaintenanceRecord
  onDone: () => Promise<void> | void
  /** `inline` drops the card chrome for use inside a list row. */
  variant?: 'card' | 'inline'
}

/**
 * Moving a serialized repair along, or ending it.
 *
 * Explicit actions rather than a status dropdown, for the same reason unit
 * lifecycle uses them: the middle steps are paperwork about equipment that has
 * not moved, while returning or cancelling brings a whole batch home and has to
 * be atomic with the units and the parent counts.
 */
export function SerializedMaintenanceActions({ record, onDone, variant = 'card' }: Props) {
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<MaintenanceStatus | null>(null)

  // One source for what a repair can do next, shared with the list.
  const steps = maintenanceWorkflowSteps(record)
  const planned = isPlannedMaintenance(record)
  const [startAt, setStartAt] = useState<MaintenanceStatus>('sent')

  const details = {
    issueDescription: record.issue_description,
    sentAt: record.sent_at ?? null,
    returnMethod: record.return_method ?? null,
    expectedReturnAt: record.expected_return_at ?? null,
    returnedAt: record.returned_at ?? null,
    serviceProviderName: record.service_provider_name,
    serviceProviderPhone: record.service_provider_phone,
    serviceProviderEmail: record.service_provider_email,
    cost: record.cost ?? null,
    repairNotes: record.repair_notes,
  }

  /**
   * Starting a plan is its own operation: the equipment has not moved yet, and
   * every piece of it has to be on the shelf at this exact moment. Which stage
   * to start at is asked here rather than offered as three separate buttons.
   */
  async function startPlan(to: MaintenanceStatus) {
    if (pending) return
    setError(null)
    setPending(to)

    try {
      await startPlannedMaintenance({ record, status: to, input: details })
      await onDone()
    } catch (caught) {
      setError(toOrganizationErrorMessage(caught))
    } finally {
      setPending(null)
    }
  }

  async function cancelPlan() {
    if (pending) return
    setError(null)
    setPending('cancelled')

    try {
      await cancelMaintenancePlan({ record, input: details })
      await onDone()
    } catch (caught) {
      setError(toOrganizationErrorMessage(caught))
    } finally {
      setPending(null)
    }
  }

  async function move(to: MaintenanceStatus) {
    if (pending) return

    // A plan has its own two operations; neither moves through the ordinary
    // workflow update, because neither is a step in a repair that is under way.
    if (planned) {
      if (to === 'cancelled') return cancelPlan()
      return startPlan(startAt)
    }

    setError(null)
    setPending(to)

    try {
      await updateSerializedMaintenance({
        record,
        to,
        // Returning is when the equipment actually came back, so an old return
        // date is not carried into it.
        input: { ...details, returnedAt: to === 'returned' ? null : details.returnedAt },
      })
      await onDone()
    } catch (caught) {
      setError(toOrganizationErrorMessage(caught))
    } finally {
      setPending(null)
    }
  }

  const startStage = planned ? (
    <div className="space-y-2">
      <Label htmlFor="plan-start-status">Start the repair as</Label>
      <Select
        value={startAt}
        onValueChange={(value) => setStartAt(value as MaintenanceStatus)}
        disabled={pending !== null}
      >
        <SelectTrigger id="plan-start-status" className="sm:max-w-xs"><SelectValue /></SelectTrigger>
        <SelectContent>
          {SERIALIZED_ACTIVE_STATUSES.map((status) => (
            <SelectItem key={status} value={status}>
              {MAINTENANCE_STATUS_LABELS[status]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-muted-foreground text-xs">
        Every planned unit has to be available right now. The equipment leaves the inventory when
        the repair starts, not before.
      </p>
    </div>
  ) : null

  const buttons = (
    <div className="flex flex-wrap gap-2">
      {steps.map((step) => (
        <Button
          key={step.to}
          size="sm"
          variant={step.tone}
          onClick={() => void move(step.to)}
          disabled={pending !== null}
        >
          {pending === step.to ? 'Saving…' : step.label}
        </Button>
      ))}
    </div>
  )

  if (variant === 'inline') {
    return (
      <div className="space-y-3">
        {startStage}
        {steps.length > 0 ? buttons : null}
        {error ? (
          <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>
        ) : null}
      </div>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Repair workflow</CardTitle>
        <CardDescription>
          {planned
            ? 'The equipment is not reserved and may still be used until the repair starts.'
            : steps.length > 0
              ? 'Returning or cancelling brings every piece back at once.'
              : 'This repair is finished. Its equipment is back in the inventory.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {startStage}
        {steps.length > 0 ? buttons : null}
        {error ? (
          <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>
        ) : null}
      </CardContent>
    </Card>
  )
}
