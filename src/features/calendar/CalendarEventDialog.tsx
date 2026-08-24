import { useEffect, useState } from 'react'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useOrganization } from '@/features/organizations/useOrganization'
import { hasModuleAccess } from '@/domain/module-access'
import { dateKeyOf, dateKeyToTimestamp, validateEventTimes, validateVisibility } from '@/domain/calendar'
import {
  createCalendarEvent, deleteCalendarEvent, updateCalendarEvent,
} from '@/services/calendar-service'
import { listMaintenanceRecords } from '@/services/maintenance-service'
import { listProductions } from '@/services/production-service'
import { toOrganizationErrorMessage } from '@/services/organization-errors-view'
import { EVENT_TYPE_SUGGESTIONS, type CalendarEvent, type CalendarVisibility } from '@/types/calendar'
import type { MaintenanceRecord } from '@/types/maintenance'
import type { Production } from '@/types/production'

/** The Select value standing for "no linked record". */
const NO_LINK = 'none'

interface Props {
  existing: CalendarEvent | null
  /** Pre-selected date for a new event, as 'YYYY-MM-DD'. */
  defaultDateKey: string
  canEdit: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: () => Promise<void> | void
}

export function CalendarEventDialog({
  existing, defaultDateKey, canEdit, open, onOpenChange, onSaved,
}: Props) {
  const { organization, membership, role, teams } = useOrganization()
  const permissions = membership?.permissions ?? null
  const canViewProductions = hasModuleAccess(role, permissions, 'productions', 'view')
  const canViewMaintenance = hasModuleAccess(role, permissions, 'maintenance', 'view')

  const [title, setTitle] = useState(existing?.title ?? '')
  const [eventType, setEventType] = useState(existing?.event_type ?? EVENT_TYPE_SUGGESTIONS[0])
  const [dateKey, setDateKey] = useState(existing ? dateKeyOf(existing) : defaultDateKey)
  const [allDay, setAllDay] = useState(existing ? !existing.start_time : true)
  const [startTime, setStartTime] = useState(existing?.start_time ?? '')
  const [endTime, setEndTime] = useState(existing?.end_time ?? '')
  const [visibility, setVisibility] = useState<CalendarVisibility>(existing?.visibility ?? 'all_teams')
  const [teamIds, setTeamIds] = useState<string[]>(existing?.team_ids ?? [])
  const [productionId, setProductionId] = useState(existing?.production_id ?? '')
  const [maintenanceId, setMaintenanceId] = useState(existing?.maintenance_id ?? '')
  const [notes, setNotes] = useState(existing?.notes ?? '')
  const [productions, setProductions] = useState<Production[]>([])
  const [records, setRecords] = useState<MaintenanceRecord[]>([])
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // Linkable records are loaded here rather than on the calendar page: they are
  // only needed once the form opens, and each list depends on its own module
  // permission. A denial leaves the list empty instead of failing the dialog.
  useEffect(() => {
    const organizationId = organization?.organization_id
    if (!organizationId) return

    if (canViewProductions) {
      listProductions(organizationId).then(setProductions, () => setProductions([]))
    }
    if (canViewMaintenance) {
      listMaintenanceRecords(organizationId).then(setRecords, () => setRecords([]))
    }
  }, [organization?.organization_id, canViewProductions, canViewMaintenance])

  function toggleTeam(teamId: string) {
    setTeamIds((current) =>
      current.includes(teamId) ? current.filter((id) => id !== teamId) : [...current, teamId],
    )
  }

  async function save() {
    if (submitting || !organization) return
    setError(null)

    if (title.trim().length === 0) {
      setError('Give the event a title.')
      return
    }
    if (dateKey.length === 0) {
      setError('Choose a date.')
      return
    }

    // All-day means no times at all; that is what the absence of a start time
    // records in the document.
    const start = allDay ? '' : startTime
    const end = allDay ? '' : endTime

    const times = validateEventTimes({ startTime: start, endTime: end })
    if (!times.valid) {
      setError(times.message)
      return
    }

    const teamSelection = visibility === 'all_teams' ? [] : teamIds
    const audience = validateVisibility({ visibility, teamIds: teamSelection })
    if (!audience.valid) {
      setError(audience.message)
      return
    }

    const input = {
      title,
      eventType,
      eventDate: dateKeyToTimestamp(dateKey),
      startTime: start,
      endTime: end,
      visibility,
      teamIds: teamSelection,
      // A link the current user cannot browse is still carried through unchanged
      // rather than dropped on save.
      productionId: productionId || null,
      maintenanceId: maintenanceId || null,
      notes,
    }

    setSubmitting(true)
    try {
      if (existing) {
        await updateCalendarEvent({ existing, input })
      } else {
        await createCalendarEvent({ organizationId: organization.organization_id, input })
      }
      await onSaved()
      onOpenChange(false)
    } catch (caught) {
      setError(toOrganizationErrorMessage(caught))
    } finally {
      setSubmitting(false)
    }
  }

  async function remove() {
    if (submitting || !existing) return
    setError(null)
    setSubmitting(true)
    try {
      await deleteCalendarEvent(existing.event_id)
      await onSaved()
      onOpenChange(false)
    } catch (caught) {
      setError(toOrganizationErrorMessage(caught))
    } finally {
      setSubmitting(false)
    }
  }

  const readOnly = !canEdit

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {readOnly ? existing?.title : existing ? 'Edit event' : 'New event'}
          </DialogTitle>
          <DialogDescription>
            {readOnly
              ? 'You have read-only access to the calendar.'
              : 'Leave the times empty for an all-day item such as a build day.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="cal-title">Title</Label>
            <Input id="cal-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} disabled={submitting || readOnly} />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="cal-date">Date</Label>
              <Input id="cal-date" type="date" value={dateKey} onChange={(e) => setDateKey(e.target.value)} disabled={submitting || readOnly} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cal-type">Event type</Label>
              <Input
                id="cal-type"
                value={eventType}
                onChange={(e) => setEventType(e.target.value)}
                list="cal-type-suggestions"
                maxLength={60}
                disabled={submitting || readOnly}
              />
              <datalist id="cal-type-suggestions">
                {EVENT_TYPE_SUGGESTIONS.map((suggestion) => (
                  <option key={suggestion} value={suggestion} />
                ))}
              </datalist>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Time</Label>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant={allDay ? 'default' : 'outline'}
                onClick={() => setAllDay(true)}
                disabled={submitting || readOnly}
                aria-pressed={allDay}
              >
                All day
              </Button>
              <Button
                type="button"
                size="sm"
                variant={allDay ? 'outline' : 'default'}
                onClick={() => setAllDay(false)}
                disabled={submitting || readOnly}
                aria-pressed={!allDay}
              >
                Set a time
              </Button>
            </div>
            {!allDay ? (
              <div className="grid gap-4 pt-2 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="cal-start">Start</Label>
                  <Input id="cal-start" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} disabled={submitting || readOnly} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="cal-end">End (optional)</Label>
                  <Input id="cal-end" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} disabled={submitting || readOnly} />
                </div>
              </div>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label>Who it concerns</Label>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant={visibility === 'all_teams' ? 'default' : 'outline'}
                onClick={() => { setVisibility('all_teams'); setTeamIds([]) }}
                disabled={submitting || readOnly}
                aria-pressed={visibility === 'all_teams'}
              >
                All teams
              </Button>
              <Button
                type="button"
                size="sm"
                variant={visibility === 'teams' ? 'default' : 'outline'}
                onClick={() => setVisibility('teams')}
                disabled={submitting || readOnly}
                aria-pressed={visibility === 'teams'}
              >
                Specific teams
              </Button>
            </div>
            {visibility === 'teams' ? (
              <>
                <div className="flex flex-wrap gap-2 pt-2">
                  {teams.map((team) => (
                    <Button
                      key={team.team_id}
                      type="button"
                      size="sm"
                      variant={teamIds.includes(team.team_id) ? 'default' : 'outline'}
                      onClick={() => toggleTeam(team.team_id)}
                      disabled={submitting || readOnly}
                      aria-pressed={teamIds.includes(team.team_id)}
                    >
                      {team.name}
                    </Button>
                  ))}
                </div>
                <p className="text-muted-foreground text-xs">
                  Tagging a team labels and filters the event. It does not restrict who can see it —
                  everyone with calendar access reads the whole organization's schedule.
                </p>
              </>
            ) : null}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="cal-production">Linked production (optional)</Label>
              {canViewProductions ? (
                <Select
                  value={productionId || NO_LINK}
                  onValueChange={(value) => setProductionId(value === NO_LINK ? '' : value)}
                  disabled={submitting || readOnly}
                >
                  <SelectTrigger id="cal-production"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_LINK}>Not linked</SelectItem>
                    {productions.map((production) => (
                      <SelectItem key={production.production_id} value={production.production_id}>
                        {production.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <p className="text-muted-foreground text-xs">
                  {productionId
                    ? 'A production is linked. It stays linked, but you need Productions access to change it.'
                    : 'Needs Productions view access.'}
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="cal-maintenance">Linked repair record (optional)</Label>
              {canViewMaintenance ? (
                <Select
                  value={maintenanceId || NO_LINK}
                  onValueChange={(value) => setMaintenanceId(value === NO_LINK ? '' : value)}
                  disabled={submitting || readOnly}
                >
                  <SelectTrigger id="cal-maintenance"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_LINK}>Not linked</SelectItem>
                    {records.map((record) => (
                      <SelectItem key={record.maintenance_id} value={record.maintenance_id}>
                        {record.issue_description.slice(0, 60)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <p className="text-muted-foreground text-xs">
                  {maintenanceId
                    ? 'A repair record is linked. It stays linked, but you need Maintenance access to change it.'
                    : 'Needs Maintenance view access.'}
                </p>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="cal-notes">Notes</Label>
            <textarea
              id="cal-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={2000}
              rows={3}
              disabled={submitting || readOnly}
              className="border-input bg-transparent focus-visible:ring-ring w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none"
            />
          </div>

          {error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}
        </div>

        <DialogFooter className="sm:justify-between">
          {existing && canEdit ? (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" disabled={submitting}>Delete</Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete this event?</AlertDialogTitle>
                  <AlertDialogDescription>
                    It disappears from the calendar for everyone. Unlike repair records and action
                    items, calendar events are not kept as history.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={remove}>Delete</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ) : <span />}

          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
              {readOnly ? 'Close' : 'Cancel'}
            </Button>
            {canEdit ? (
              <Button onClick={save} disabled={submitting}>
                {submitting ? 'Saving…' : existing ? 'Save changes' : 'Create event'}
              </Button>
            ) : null}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
