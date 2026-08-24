import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useOrganization } from '@/features/organizations/useOrganization'
import { hasModuleAccess } from '@/domain/module-access'
import {
  addMonths, buildMonthGrid, formatEventTime, isAllDay, toDateKey,
} from '@/domain/calendar'
import {
  EMPTY_CALENDAR_FILTERS, audienceLabel, eventsInMonth, eventsOnDate, filterCalendarEvents,
  groupEventsByDate, usedEventTypes, type CalendarFilters,
} from '@/features/calendar/calendar-view'
import { CalendarEventDialog } from '@/features/calendar/CalendarEventDialog'
import { listCalendarEvents } from '@/services/calendar-service'
import { toOrganizationErrorMessage } from '@/services/organization-errors-view'
import type { CalendarEvent } from '@/types/calendar'
import { cn } from '@/lib/utils'

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const MONTH_FORMAT = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' })
const DAY_FORMAT = new Intl.DateTimeFormat(undefined, {
  weekday: 'long', month: 'long', day: 'numeric',
})

export function CalendarPage() {
  const { organization, membership, role, teams } = useOrganization()
  const organizationId = organization?.organization_id ?? null

  const today = useMemo(() => new Date(), [])
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth())
  const [selectedDateKey, setSelectedDateKey] = useState(toDateKey(today))

  const [events, setEvents] = useState<CalendarEvent[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filters, setFilters] = useState<CalendarFilters>(EMPTY_CALENDAR_FILTERS)
  // `?new=1` opens the create dialog directly, which is what the dashboard's
  // Add calendar event action links to. Read once: closing the dialog should not
  // reopen it.
  const [searchParams, setSearchParams] = useSearchParams()
  const [editing, setEditing] = useState<CalendarEvent | null | undefined>(
    () => (searchParams.get('new') === '1' ? null : undefined),
  )

  const canEdit = hasModuleAccess(role, membership?.permissions ?? null, 'calendar', 'edit')

  const load = useCallback(async () => {
    if (!organizationId) return
    setError(null)
    try {
      setEvents(await listCalendarEvents(organizationId))
    } catch (caught) {
      setError(toOrganizationErrorMessage(caught))
      setEvents([])
    }
  }, [organizationId])

  useEffect(() => {
    void load()
  }, [load])

  // The whole organization's events are loaded once and the month is selected
  // here. A date-range query would need a composite index and gain nothing at a
  // school theater's volume.
  const visible = useMemo(
    () => (events ? filterCalendarEvents(events, filters) : []),
    [events, filters],
  )
  const monthEvents = useMemo(() => eventsInMonth(visible, year, month), [visible, year, month])
  const byDate = useMemo(() => groupEventsByDate(monthEvents), [monthEvents])
  const grid = useMemo(() => buildMonthGrid(year, month), [year, month])
  const selectedEvents = useMemo(() => eventsOnDate(visible, selectedDateKey), [visible, selectedDateKey])
  const eventTypes = useMemo(() => usedEventTypes(events ?? []), [events])

  const todayKey = toDateKey(today)

  function shiftMonth(delta: number) {
    const next = addMonths(year, month, delta)
    setYear(next.year)
    setMonth(next.month)
  }

  function goToToday() {
    setYear(today.getFullYear())
    setMonth(today.getMonth())
    setSelectedDateKey(todayKey)
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Calendar</h1>
          <p className="text-muted-foreground text-sm">
            Rehearsals, build days, inspections, and deadlines for the whole organization.
          </p>
        </div>
        {canEdit ? (
          <Button size="sm" onClick={() => setEditing(null)}>
            <Plus className="size-4" aria-hidden="true" />
            New event
          </Button>
        ) : null}
      </div>

      <Card>
        <CardContent className="grid gap-3 pt-6 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-xs">Team</Label>
            <Select value={filters.teamId} onValueChange={(v) => setFilters((c) => ({ ...c, teamId: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All teams</SelectItem>
                {teams.map((team) => (
                  <SelectItem key={team.team_id} value={team.team_id}>{team.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-muted-foreground text-xs">
              Events addressed to all teams always appear.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Event type</Label>
            <Select value={filters.eventType} onValueChange={(v) => setFilters((c) => ({ ...c, eventType: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any type</SelectItem>
                {eventTypes.map((type) => (
                  <SelectItem key={type} value={type}>{type}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">{MONTH_FORMAT.format(new Date(year, month, 1))}</h2>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" onClick={() => shiftMonth(-1)} aria-label="Previous month">
            <ChevronLeft className="size-4" aria-hidden="true" />
          </Button>
          <Button variant="outline" size="sm" onClick={goToToday}>Today</Button>
          <Button variant="outline" size="icon" onClick={() => shiftMonth(1)} aria-label="Next month">
            <ChevronRight className="size-4" aria-hidden="true" />
          </Button>
        </div>
      </div>

      {events === null ? (
        <p className="text-muted-foreground text-sm">Loading calendar…</p>
      ) : (
        <>
          {/* Month grid. Hidden below sm, where the agenda list is the calendar. */}
          <div className="hidden sm:block">
            <div className="grid grid-cols-7 gap-px">
              {WEEKDAYS.map((day) => (
                <div key={day} className="text-muted-foreground px-2 pb-1 text-center text-xs font-medium">
                  {day}
                </div>
              ))}
            </div>
            <div className="border-border bg-border grid grid-cols-7 gap-px overflow-hidden rounded-md border">
              {grid.map((date) => {
                const key = toDateKey(date)
                const dayEvents = byDate.get(key) ?? []
                const inMonth = date.getMonth() === month
                const isToday = key === todayKey
                const isSelected = key === selectedDateKey

                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setSelectedDateKey(key)}
                    className={cn(
                      'bg-card min-h-24 p-1.5 text-left align-top transition-colors',
                      'focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none',
                      !inMonth && 'text-muted-foreground bg-muted/40',
                      isSelected && 'ring-ring ring-2 ring-inset',
                      'hover:bg-accent/40',
                    )}
                    aria-current={isToday ? 'date' : undefined}
                  >
                    <span
                      className={cn(
                        'inline-flex size-6 items-center justify-center rounded-full text-xs tabular-nums',
                        isToday && 'bg-primary text-primary-foreground font-semibold',
                      )}
                    >
                      {date.getDate()}
                    </span>
                    <ul className="mt-1 space-y-0.5">
                      {dayEvents.slice(0, 3).map((event) => (
                        <li key={event.event_id} className="truncate text-xs">
                          <span className="text-muted-foreground tabular-nums">
                            {isAllDay(event) ? '•' : event.start_time}
                          </span>{' '}
                          {event.title}
                        </li>
                      ))}
                      {dayEvents.length > 3 ? (
                        <li className="text-muted-foreground text-xs">
                          +{dayEvents.length - 3} more
                        </li>
                      ) : null}
                    </ul>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Day panel on desktop; the primary view on a phone. */}
          <Card>
            <CardContent className="space-y-3 pt-6">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-semibold">{DAY_FORMAT.format(new Date(`${selectedDateKey}T00:00:00`))}</h3>
                <div className="flex gap-1 sm:hidden">
                  <Button variant="outline" size="icon" onClick={() => shiftMonth(-1)} aria-label="Previous month">
                    <ChevronLeft className="size-4" aria-hidden="true" />
                  </Button>
                  <Button variant="outline" size="icon" onClick={() => shiftMonth(1)} aria-label="Next month">
                    <ChevronRight className="size-4" aria-hidden="true" />
                  </Button>
                </div>
              </div>

              {/* On a phone the grid is hidden, so the month's dates that have
                  events are offered directly. */}
              <div className="flex flex-wrap gap-1 sm:hidden">
                {[...byDate.keys()].sort().map((key) => (
                  <Button
                    key={key}
                    size="sm"
                    variant={key === selectedDateKey ? 'default' : 'outline'}
                    onClick={() => setSelectedDateKey(key)}
                    className="tabular-nums"
                  >
                    {Number(key.slice(8))}
                  </Button>
                ))}
              </div>

              {selectedEvents.length === 0 ? (
                <p className="text-muted-foreground text-sm">
                  Nothing scheduled on this date.
                  {canEdit ? ' Use New event to add something.' : ''}
                </p>
              ) : (
                <ul className="divide-border divide-y">
                  {selectedEvents.map((event) => (
                    <li key={event.event_id}>
                      <button
                        type="button"
                        onClick={() => setEditing(event)}
                        className="hover:bg-accent/40 focus-visible:ring-ring w-full py-3 text-left focus-visible:ring-2 focus-visible:outline-none"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-muted-foreground text-sm tabular-nums">
                            {formatEventTime(event)}
                          </span>
                          <span className="min-w-0 flex-1 truncate font-medium">{event.title}</span>
                          <Badge variant="secondary">{event.event_type}</Badge>
                          {event.production_id ? <Badge variant="outline">Production</Badge> : null}
                          {event.maintenance_id ? <Badge variant="outline">Repair</Badge> : null}
                        </div>
                        <p className="text-muted-foreground mt-1 text-xs">
                          {audienceLabel(event, teams)}
                        </p>
                        {event.notes ? (
                          <p className="text-muted-foreground mt-1 line-clamp-2 text-xs">{event.notes}</p>
                        ) : null}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <p className="text-muted-foreground text-xs">
            {monthEvents.length} event{monthEvents.length === 1 ? '' : 's'} this month
            {events.length !== visible.length ? ` · ${events.length - visible.length} hidden by filters` : ''}
          </p>
        </>
      )}

      {editing !== undefined ? (
        <CalendarEventDialog
          key={editing?.event_id ?? `new-${selectedDateKey}`}
          existing={editing}
          defaultDateKey={selectedDateKey}
          canEdit={canEdit}
          open
          onOpenChange={(open) => {
            if (open) return
            setEditing(undefined)
            if (searchParams.has('new')) setSearchParams({}, { replace: true })
          }}
          onSaved={load}
        />
      ) : null}
    </div>
  )
}
